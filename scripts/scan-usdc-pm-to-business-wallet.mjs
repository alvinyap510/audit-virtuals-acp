import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  formatUnits,
  getAddress,
  zeroPadValue
} from "ethers";

const DEFAULT_CHUNK_SIZE = 1000;
const PAYOUT_CONFIG = {
  rpcUrl: "https://base-mainnet.g.alchemy.com/v2/SHPLF4YT-0gN1ieWxTl21F2gTaBNGAWy",
  usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  paymentManager: "0xEF4364Fe4487353dF46eb7c811D4FAc78b856c7F",
  receiverWallet: "0xB74e20957654503D0a7F49Bcb01FA86950467657",
  startBlock: 42126570,
  chunkSize: 10000,
  out: "",
  decimalsOverride: null
};

const TRANSFER_ABI = ["event Transfer(address indexed from, address indexed to, uint256 value)"];
const ERC20_META_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];
const transferInterface = new Interface(TRANSFER_ABI);
const TRANSFER_TOPIC = transferInterface.getEvent("Transfer").topicHash;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const [keyRaw, inlineValue] = token.slice(2).split("=", 2);
    const key = keyRaw.trim();
    const next = argv[index + 1];
    const value = inlineValue ?? (next && !next.startsWith("--") ? next : "true");
    if (inlineValue == null && value === next && next && !next.startsWith("--")) {
      index += 1;
    }
    args[key] = value;
  }
  return args;
}

function parsePositiveInt(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return parsed;
}

function toCsvCell(value) {
  const stringValue = String(value ?? "");
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }
  return stringValue;
}

function buildCsv(rows) {
  const header = [
    "tx_hash",
    "block_number",
    "timestamp_utc",
    "from_wallet",
    "to_wallet",
    "amount_raw",
    "amount_token"
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.txHash,
        row.blockNumber,
        row.timestampUtc,
        row.from,
        row.to,
        row.amountRaw,
        row.amountToken
      ]
        .map(toCsvCell)
        .join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

async function retry(label, fn, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      const delayMs = attempt * 1000;
      console.warn(`[retry] ${label} failed (attempt ${attempt}/${attempts}), retrying in ${delayMs}ms`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }
  throw lastError;
}

function formatIsoUtc(timestampSeconds) {
  return new Date(Number(timestampSeconds) * 1000).toISOString();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log(`Usage:
  1) Edit PAYOUT_CONFIG in scripts/scan-usdc-pm-to-business-wallet.mjs (optional)
  2) Run: pnpm scan:pm-to-business

Optional CLI overrides:
  --rpc, --usdc, --payment-manager, --receiver, --start-block, --chunk-size, --out, --decimals
`);
    return;
  }

  const rpcUrl = args.rpc ?? process.env.RPC_URL ?? PAYOUT_CONFIG.rpcUrl;
  if (!rpcUrl) {
    throw new Error("Missing RPC URL. Set PAYOUT_CONFIG.rpcUrl (or pass --rpc / RPC_URL).");
  }

  const usdcAddress = getAddress(args.usdc ?? process.env.USDC_ADDRESS ?? PAYOUT_CONFIG.usdcAddress);
  const paymentManager = getAddress(args["payment-manager"] ?? PAYOUT_CONFIG.paymentManager);
  const receiverWallet = getAddress(args.receiver ?? PAYOUT_CONFIG.receiverWallet);
  const startBlock = parsePositiveInt(args["start-block"] ?? PAYOUT_CONFIG.startBlock, "start-block");
  const chunkSize = parsePositiveInt(args["chunk-size"] ?? PAYOUT_CONFIG.chunkSize ?? DEFAULT_CHUNK_SIZE, "chunk-size");

  const provider = new JsonRpcProvider(rpcUrl);
  const latestBlock = await retry("get latest block number", () => provider.getBlockNumber());
  if (startBlock > latestBlock) {
    throw new Error(`start-block ${startBlock} is greater than latest block ${latestBlock}`);
  }

  const token = new Contract(usdcAddress, ERC20_META_ABI, provider);
  let decimals = 6;
  let symbol = "USDC";
  if (args.decimals != null || PAYOUT_CONFIG.decimalsOverride != null) {
    decimals = parsePositiveInt(args.decimals ?? PAYOUT_CONFIG.decimalsOverride, "decimals");
  } else {
    try {
      decimals = Number(await retry("read token decimals", () => token.decimals()));
    } catch {
      decimals = 6;
    }
  }
  try {
    symbol = await retry("read token symbol", () => token.symbol());
  } catch {
    symbol = "USDC";
  }

  const paymentManagerTopic = zeroPadValue(paymentManager, 32);
  const receiverTopic = zeroPadValue(receiverWallet, 32);
  const blockTimestampCache = new Map();
  const rows = [];
  let totalRaw = 0n;

  console.log(`[config] token: ${usdcAddress} (${symbol}, decimals=${decimals})`);
  console.log(`[config] payer (PaymentManager): ${paymentManager}`);
  console.log(`[config] receiver (ACP Business): ${receiverWallet}`);
  console.log(`[config] scanning blocks ${startBlock} -> ${latestBlock} in chunks of ${chunkSize}`);

  for (let fromBlock = startBlock; fromBlock <= latestBlock; fromBlock += chunkSize) {
    const toBlock = Math.min(fromBlock + chunkSize - 1, latestBlock);
    console.log(`[scan] ${fromBlock} -> ${toBlock}`);

    const logs = await retry(`getLogs ${fromBlock}-${toBlock}`, () =>
      provider.getLogs({
        address: usdcAddress,
        fromBlock,
        toBlock,
        topics: [TRANSFER_TOPIC, paymentManagerTopic, receiverTopic]
      })
    );

    if (logs.length === 0) {
      continue;
    }

    for (const log of logs) {
      const parsed = transferInterface.parseLog(log);
      const from = getAddress(parsed.args.from);
      const to = getAddress(parsed.args.to);
      const amountRaw = parsed.args.value;
      totalRaw += amountRaw;

      let timestamp = blockTimestampCache.get(log.blockNumber);
      if (timestamp == null) {
        const block = await retry(`getBlock ${log.blockNumber}`, () => provider.getBlock(log.blockNumber));
        if (!block) {
          throw new Error(`Block ${log.blockNumber} not found`);
        }
        timestamp = Number(block.timestamp);
        blockTimestampCache.set(log.blockNumber, timestamp);
      }

      rows.push({
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        timestampUtc: formatIsoUtc(timestamp),
        from,
        to,
        amountRaw: amountRaw.toString(),
        amountToken: formatUnits(amountRaw, decimals)
      });
    }
  }

  rows.sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber - right.blockNumber;
    }
    return left.txHash.localeCompare(right.txHash);
  });

  const outputPath =
    args.out != null
      ? resolve(process.cwd(), args.out)
      : PAYOUT_CONFIG.out
        ? resolve(process.cwd(), PAYOUT_CONFIG.out)
        : resolve(process.cwd(), `data/normalized/pm-to-business-${symbol.toLowerCase()}-${startBlock}-${latestBlock}.csv`);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buildCsv(rows), "utf8");

  console.log("");
  console.log(`[result] matched transfers: ${rows.length}`);
  console.log(`[result] csv written: ${outputPath}`);
  console.log(`[result] total_raw: ${totalRaw.toString()}`);
  console.log(`[result] total_${symbol}: ${formatUnits(totalRaw, decimals)}`);
}

main().catch((error) => {
  console.error("[fatal]", error?.message ?? error);
  process.exitCode = 1;
});

