import process from "node:process";
import { Contract, JsonRpcProvider, formatUnits, getAddress } from "ethers";

const SNAPSHOT_CONFIG = {
  rpcUrl: "https://base-mainnet.g.alchemy.com/v2/SHPLF4YT-0gN1ieWxTl21F2gTaBNGAWy",
  usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  wallet: "0x93a0baf7295d99b143cfdc480f4cc879cbe1b52c",
  blockNumber: 42343824,
  decimalsOverride: null
};

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log(`Usage:
  1) Edit SNAPSHOT_CONFIG in scripts/snapshot-usdc-wallet-at-block.mjs (optional)
  2) Run: pnpm snapshot:wallet-usdc

Optional CLI overrides:
  --rpc, --usdc, --wallet, --block, --decimals
`);
    return;
  }

  const rpcUrl = args.rpc ?? process.env.RPC_URL ?? SNAPSHOT_CONFIG.rpcUrl;
  if (!rpcUrl) {
    throw new Error("Missing RPC URL. Set SNAPSHOT_CONFIG.rpcUrl (or pass --rpc / RPC_URL).");
  }

  const usdcAddress = getAddress(args.usdc ?? process.env.USDC_ADDRESS ?? SNAPSHOT_CONFIG.usdcAddress);
  const wallet = getAddress(args.wallet ?? SNAPSHOT_CONFIG.wallet);
  const blockNumber = parsePositiveInt(args.block ?? SNAPSHOT_CONFIG.blockNumber, "block");

  const provider = new JsonRpcProvider(rpcUrl);
  const token = new Contract(usdcAddress, ERC20_ABI, provider);

  const [block, decimalsRead, symbolRead, balanceRaw] = await Promise.all([
    retry(`getBlock ${blockNumber}`, () => provider.getBlock(blockNumber)),
    SNAPSHOT_CONFIG.decimalsOverride == null && args.decimals == null
      ? retry("read token decimals", () => token.decimals()).catch(() => 6)
      : Promise.resolve(parsePositiveInt(args.decimals ?? SNAPSHOT_CONFIG.decimalsOverride, "decimals")),
    retry("read token symbol", () => token.symbol()).catch(() => "USDC"),
    retry(`balanceOf ${wallet} @ ${blockNumber}`, () => token.balanceOf(wallet, { blockTag: blockNumber }))
  ]);

  if (!block) {
    throw new Error(`Block ${blockNumber} not found`);
  }

  const decimals = Number(decimalsRead);
  const symbol = String(symbolRead);
  const formatted = formatUnits(balanceRaw, decimals);

  console.log(JSON.stringify({
    blockNumber,
    timestamp: Number(block.timestamp),
    timestampUtc: new Date(Number(block.timestamp) * 1000).toISOString(),
    wallet,
    token: usdcAddress,
    symbol,
    decimals,
    balanceRaw: balanceRaw.toString(),
    balanceToken: formatted
  }, null, 2));
}

main().catch((error) => {
  console.error("[fatal]", error?.message ?? error);
  process.exitCode = 1;
});

