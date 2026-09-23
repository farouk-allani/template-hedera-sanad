/**
 * The Hedera mirror node's REST API. Everything the token itself decides (KYC, freeze, pause, who
 * holds which key, who is associated) is readable here and nowhere else, so the app reads it here
 * rather than through contract calls.
 */
export const MIRROR_NODE_URL = "https://testnet.mirrornode.hedera.com";

export type MirrorKey = { _type: string; key: string } | null;

export type MirrorToken = {
  token_id: string;
  name: string;
  symbol: string;
  decimals: string;
  total_supply: string;
  treasury_account_id: string;
  pause_status: "PAUSED" | "UNPAUSED" | "NOT_APPLICABLE";
  admin_key: MirrorKey;
  kyc_key: MirrorKey;
  freeze_key: MirrorKey;
  pause_key: MirrorKey;
  wipe_key: MirrorKey;
  supply_key: MirrorKey;
};

export type MirrorAccount = {
  account: string;
  evm_address: string;
  key: MirrorKey;
  balance: { balance: number };
};

/** An account's standing with one token. The mirror node reports "never approved" as REVOKED. */
export type TokenRelationship = {
  token_id: string;
  balance: number;
  kyc_status: "GRANTED" | "REVOKED" | "NOT_APPLICABLE";
  freeze_status: "FROZEN" | "UNFROZEN" | "NOT_APPLICABLE";
};

export type MirrorLog = {
  data: `0x${string}`;
  topics: `0x${string}`[];
  timestamp: string;
  transaction_hash: `0x${string}`;
  index: number;
};

export type MirrorContractResult = {
  result: string;
  call_result: `0x${string}` | null;
};

/** GET a mirror node route. Resolves to null when the entity does not exist. */
export async function mirrorGet<T>(route: string): Promise<T | null> {
  const response = await fetch(`${MIRROR_NODE_URL}/api/v1${route}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The mirror node answered ${response.status} for ${route}.`);
  return (await response.json()) as T;
}

export const accountRoute = (idOrAddress: string) => `/accounts/${idOrAddress}?transactions=false`;

export const relationshipRoute = (idOrAddress: string, tokenId: string) =>
  `/accounts/${idOrAddress}/tokens?token.id=${tokenId}`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Polls a route until the mirror node shows what a transaction changed. It trails consensus by a
 * few seconds. Resolves to false if it never does, which means the change did not happen.
 */
export async function waitForMirror<T>(route: string, reached: (data: T | null) => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (reached(await mirrorGet<T>(route))) return true;
    await sleep(1500);
  }
  return false;
}

export async function waitForContractResult(hash: string): Promise<MirrorContractResult> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await mirrorGet<MirrorContractResult>(`/contracts/results/${hash}`);
    if (result) return result;
    await sleep(1500);
  }
  throw new Error("The mirror node has not recorded the transaction yet. Look it up on HashScan.");
}
