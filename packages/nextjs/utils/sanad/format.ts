import { formatUnits } from "viem";

/**
 * Contracts count HBAR in tinybars (8 decimals). Wallets and the JSON-RPC relay count it in
 * weibars (18 decimals), so every value sent with a transaction is multiplied by this.
 */
export const WEIBARS_PER_TINYBAR = 10_000_000_000n;

const HASHSCAN_URL = "https://hashscan.io/testnet";

/** HashScan takes entity IDs under /account and EVM addresses under its EIP-3091 route, /address. */
export const hashscan = {
  account: (id: string) => `${HASHSCAN_URL}/account/${id}`,
  address: (evmAddress: string) => `${HASHSCAN_URL}/address/${evmAddress}`,
  token: (id: string) => `${HASHSCAN_URL}/token/${id}`,
  contract: (idOrAddress: string) => `${HASHSCAN_URL}/contract/${idOrAddress}`,
  transaction: (hash: string) => `${HASHSCAN_URL}/tx/${hash}`,
  topic: (id: string) => `${HASHSCAN_URL}/topic/${id}`,
};

const display = (value: string, maxDecimals: number) =>
  Number(value).toLocaleString("en-US", { maximumFractionDigits: maxDecimals });

export const formatHbar = (tinybars: bigint, maxDecimals = 4) =>
  `${display(formatUnits(tinybars, 8), maxDecimals)} HBAR`;

export const formatToken = (amount: bigint, decimals: number, symbol: string) =>
  `${display(formatUnits(amount, decimals), decimals)} ${symbol}`;

export const shortHex = (hex: string) => `${hex.slice(0, 6)}…${hex.slice(-4)}`;

export const formatTimestamp = (consensusTimestamp: string) =>
  new Date(Number(consensusTimestamp.split(".")[0]) * 1000).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
