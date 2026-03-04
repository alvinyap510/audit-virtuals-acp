import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const PAYMENT_MANAGER = getAddress("0xEF4364Fe4487353dF46eb7c811D4FAc78b856c7F");
const PAYMENT_MANAGER_IMPL = getAddress("0x56C3AF6c5995147f293DC756216920FD24D50684");
const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_WALLETS_FILE = "BOT_WALLETS.md";
const SCAN_CONFIG = {
  rpcUrl: "https://base-mainnet.g.alchemy.com/v2/SHPLF4YT-0gN1ieWxTl21F2gTaBNGAWy",
  usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  startBlock: 42600000,
  chunkSize: 10000,
  walletsFile: DEFAULT_WALLETS_FILE,
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

function requireArg(args, name, envName) {
  const value = args[name] ?? (envName ? process.env[envName] : undefined);
  if (value == null || value === "") {
    throw new Error(`Missing required --${name}${envName ? ` (or ${envName})` : ""}`);
  }
  return value;
}

function parsePositiveInt(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return parsed;
}

function parseBotWallets(filePath) {
  const content = readFileSync(filePath, "utf8");
  const matches = content.match(/0x[a-fA-F0-9]{40}/g) ?? [];
  const wallets = new Set();
  for (const match of matches) {
    wallets.add(getAddress(match).toLowerCase());
  }
  if (wallets.size === 0) {
    throw new Error(`No wallet addresses found in ${filePath}`);
  }
  return wallets;
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
        row.amountFormatted
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
  1) Edit SCAN_CONFIG near the top of scripts/scan-usdc-to-payment-manager.mjs
  2) Run: pnpm scan:payment-manager

Optional CLI overrides (still supported):
  --rpc, --usdc, --start-block, --chunk-size, --wallets-file, --out, --decimals
`);
    return;
  }

  const rpcUrl = args.rpc ?? process.env.RPC_URL ?? SCAN_CONFIG.rpcUrl;
  if (!rpcUrl) {
    throw new Error("Missing RPC URL. Set SCAN_CONFIG.rpcUrl (or pass --rpc / RPC_URL).");
  }

  const usdcInput = args.usdc ?? process.env.USDC_ADDRESS ?? SCAN_CONFIG.usdcAddress;
  if (!usdcInput) {
    throw new Error("Missing USDC address. Set SCAN_CONFIG.usdcAddress (or pass --usdc / USDC_ADDRESS).");
  }
  const usdcAddress = getAddress(usdcInput);

  const startBlockInput = args["start-block"] ?? SCAN_CONFIG.startBlock;
  const startBlock = parsePositiveInt(startBlockInput, "start-block");

  const chunkSize = parsePositiveInt(
    args["chunk-size"] ?? SCAN_CONFIG.chunkSize ?? DEFAULT_CHUNK_SIZE,
    "chunk-size"
  ) || DEFAULT_CHUNK_SIZE;

  const walletsFile = resolve(process.cwd(), args["wallets-file"] ?? SCAN_CONFIG.walletsFile ?? DEFAULT_WALLETS_FILE);

  const botWallets = parseBotWallets(walletsFile);
  const provider = new JsonRpcProvider(rpcUrl);

  const latestBlock = await retry("get latest block number", () => provider.getBlockNumber());
  if (startBlock > latestBlock) {
    throw new Error(`start-block ${startBlock} is greater than latest block ${latestBlock}`);
  }

  const token = new Contract(usdcAddress, ERC20_META_ABI, provider);
  let decimals = 6;
  let symbol = "USDC";
  if (args.decimals != null || SCAN_CONFIG.decimalsOverride != null) {
    decimals = parsePositiveInt(args.decimals ?? SCAN_CONFIG.decimalsOverride, "decimals");
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

  const paddedPaymentManager = zeroPadValue(PAYMENT_MANAGER, 32);
  const rows = [];
  const totalsByWallet = new Map();
  const blockTimestampCache = new Map();

  console.log(`[config] payment manager proxy: ${PAYMENT_MANAGER}`);
  console.log(`[config] payment manager impl:  ${PAYMENT_MANAGER_IMPL}`);
  console.log(`[config] token: ${usdcAddress} (${symbol}, decimals=${decimals})`);
  console.log(`[config] bot wallets loaded: ${botWallets.size} from ${walletsFile}`);
  console.log(`[config] scanning blocks ${startBlock} -> ${latestBlock} in chunks of ${chunkSize}`);

  for (let fromBlock = startBlock; fromBlock <= latestBlock; fromBlock += chunkSize) {
    const toBlock = Math.min(fromBlock + chunkSize - 1, latestBlock);
    console.log(`[scan] ${fromBlock} -> ${toBlock}`);

    const logs = await retry(`getLogs ${fromBlock}-${toBlock}`, () =>
      provider.getLogs({
        address: usdcAddress,
        fromBlock,
        toBlock,
        topics: [TRANSFER_TOPIC, null, paddedPaymentManager]
      })
    );

    if (logs.length === 0) {
      continue;
    }

    for (const log of logs) {
      const parsed = transferInterface.parseLog(log);
      const from = getAddress(parsed.args.from);
      const to = getAddress(parsed.args.to);
      const fromKey = from.toLowerCase();

      if (!botWallets.has(fromKey)) {
        continue;
      }

      let timestamp = blockTimestampCache.get(log.blockNumber);
      if (timestamp == null) {
        const block = await retry(`getBlock ${log.blockNumber}`, () => provider.getBlock(log.blockNumber));
        if (!block) {
          throw new Error(`Block ${log.blockNumber} not found`);
        }
        timestamp = Number(block.timestamp);
        blockTimestampCache.set(log.blockNumber, timestamp);
      }

      const amountRaw = parsed.args.value;
      const nextTotal = (totalsByWallet.get(fromKey) ?? 0n) + amountRaw;
      totalsByWallet.set(fromKey, nextTotal);

      rows.push({
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        timestampUtc: formatIsoUtc(timestamp),
        from,
        to,
        amountRaw: amountRaw.toString(),
        amountFormatted: formatUnits(amountRaw, decimals)
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
      : SCAN_CONFIG.out
        ? resolve(process.cwd(), SCAN_CONFIG.out)
      : resolve(process.cwd(), `data/normalized/payment-manager-${symbol.toLowerCase()}-${startBlock}-${latestBlock}.csv`);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buildCsv(rows), "utf8");

  console.log("");
  console.log(`[result] matched transfers: ${rows.length}`);
  console.log(`[result] csv written: ${outputPath}`);
  console.log("[result] totals by wallet:");

  const sortedTotals = [...totalsByWallet.entries()].sort((a, b) => {
    if (a[1] === b[1]) {
      return a[0].localeCompare(b[0]);
    }
    return a[1] > b[1] ? -1 : 1;
  });

  if (sortedTotals.length === 0) {
    console.log("  (none)");
  } else {
    for (const [walletLower, totalRaw] of sortedTotals) {
      console.log(`  ${walletLower}, raw=${totalRaw.toString()}, ${symbol}=${formatUnits(totalRaw, decimals)}`);
    }
  }

  const grandTotal = [...totalsByWallet.values()].reduce((sum, v) => sum + v, 0n);
  console.log("");
  console.log(`[result] grand total: ${formatUnits(grandTotal, decimals)} ${symbol}`);
}

main().catch((error) => {
  console.error("[fatal]", error?.message ?? error);
  process.exitCode = 1;
});
