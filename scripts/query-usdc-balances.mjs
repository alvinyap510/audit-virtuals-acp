import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { Contract, JsonRpcProvider, formatUnits, getAddress } from "ethers";

const DEFAULT_WALLETS_FILE = "BOT_WALLETS.md";
const BALANCE_CONFIG = {
  rpcUrl: "https://base-mainnet.g.alchemy.com/v2/SHPLF4YT-0gN1ieWxTl21F2gTaBNGAWy",
  usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  walletsFile: DEFAULT_WALLETS_FILE,
  out: "",
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

function parseBotWallets(filePath) {
  const content = readFileSync(filePath, "utf8");
  const matches = content.match(/0x[a-fA-F0-9]{40}/g) ?? [];
  const wallets = [];
  const seen = new Set();
  for (const match of matches) {
    const wallet = getAddress(match);
    const key = wallet.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    wallets.push(wallet);
  }
  if (wallets.length === 0) {
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
  const header = ["wallet", "balance_raw", "balance_token"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push([row.wallet, row.balanceRaw, row.balanceToken].map(toCsvCell).join(","));
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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log(`Usage:
  1) Edit BALANCE_CONFIG near the top of scripts/query-usdc-balances.mjs
  2) Run: pnpm balances:usdc

Optional CLI overrides (still supported):
  --rpc, --usdc, --wallets-file, --out, --decimals
`);
    return;
  }

  const rpcUrl = args.rpc ?? process.env.RPC_URL ?? BALANCE_CONFIG.rpcUrl;
  if (!rpcUrl) {
    throw new Error("Missing RPC URL. Set BALANCE_CONFIG.rpcUrl (or pass --rpc / RPC_URL).");
  }

  const usdcInput = args.usdc ?? process.env.USDC_ADDRESS ?? BALANCE_CONFIG.usdcAddress;
  if (!usdcInput) {
    throw new Error("Missing USDC address. Set BALANCE_CONFIG.usdcAddress (or pass --usdc / USDC_ADDRESS).");
  }
  const usdcAddress = getAddress(usdcInput);

  const walletsFile = resolve(process.cwd(), args["wallets-file"] ?? BALANCE_CONFIG.walletsFile ?? DEFAULT_WALLETS_FILE);
  const wallets = parseBotWallets(walletsFile);

  const provider = new JsonRpcProvider(rpcUrl);
  const token = new Contract(usdcAddress, ERC20_ABI, provider);
  const latestBlock = await retry("get latest block number", () => provider.getBlockNumber());

  let decimals = 6;
  let symbol = "USDC";
  if (args.decimals != null || BALANCE_CONFIG.decimalsOverride != null) {
    decimals = parsePositiveInt(args.decimals ?? BALANCE_CONFIG.decimalsOverride, "decimals");
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

  console.log(`[config] token: ${usdcAddress} (${symbol}, decimals=${decimals})`);
  console.log(`[config] wallets loaded: ${wallets.length} from ${walletsFile}`);
  console.log(`[config] querying balances at latest block: ${latestBlock}`);

  const rows = [];
  let totalRaw = 0n;

  for (let index = 0; index < wallets.length; index += 1) {
    const wallet = wallets[index];
    const balanceRaw = await retry(`balanceOf ${wallet}`, () => token.balanceOf(wallet));
    totalRaw += balanceRaw;

    const balanceToken = formatUnits(balanceRaw, decimals);
    rows.push({
      wallet,
      balanceRaw: balanceRaw.toString(),
      balanceToken
    });

    console.log(`[${index + 1}/${wallets.length}] ${wallet} -> ${balanceToken} ${symbol}`);
  }

  const outputPath =
    args.out != null
      ? resolve(process.cwd(), args.out)
      : BALANCE_CONFIG.out
        ? resolve(process.cwd(), BALANCE_CONFIG.out)
        : resolve(process.cwd(), `data/normalized/${symbol.toLowerCase()}-balances-${latestBlock}.csv`);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buildCsv(rows), "utf8");

  console.log("");
  console.log(`[result] csv written: ${outputPath}`);
  console.log(`[result] wallets counted: ${rows.length}`);
  console.log(`[result] total_raw: ${totalRaw.toString()}`);
  console.log(`[result] total_${symbol}: ${formatUnits(totalRaw, decimals)}`);
}

main().catch((error) => {
  console.error("[fatal]", error?.message ?? error);
  process.exitCode = 1;
});

