import * as dotenv from "dotenv";
dotenv.config();
import fs from "node:fs";
import path from "node:path";
import { AccountId, Client, PrivateKey } from "@hashgraph/sdk";
import { AbiCoder, Interface, Wallet } from "ethers";
import password from "@inquirer/password";

/** Mirror node REST base. Reads come from here, so they lag consensus by a moment. */
export const MIRROR = (process.env.HEDERA_MIRROR_TESTNET_URL ?? "https://testnet.mirrornode.hedera.com").replace(
  /\/$/,
  "",
);

/** SaucerSwap V1 router (RouterV3) on testnet, per docs.saucerswap.finance/developers/contracts. */
export const SAUCERSWAP_V1_ROUTER_ID = process.env.SAUCERSWAP_V1_ROUTER_ID ?? "0.0.19264";

/** Clients send weibars (18 decimals); contracts see tinybars (8 decimals). */
export const WEIBAR_PER_TINYBAR = 10n ** 10n;

const ROOT = path.resolve(__dirname, "..", "..");
/** Finished setup. Safe to read; contains no keys. */
export const DEPLOYMENT_FILE = path.join(ROOT, ".sanad", "testnet.json");
/** Progress of a run that has not finished, so the next run resumes instead of paying again. */
export const CHECKPOINT_FILE = path.join(ROOT, ".sanad", "testnet.partial.json");
/** Throwaway testnet keys for the demo roles and buyers. Gitignored, never commit. */
export const KEYS_FILE = path.join(ROOT, ".sanad", "testnet.keys.json");
/** Mirror node links for the last acceptance run, for the submission. */
export const EVIDENCE_FILE = path.join(ROOT, ".sanad", "testnet-run.json");

/** The token keys the demo generates separately, one per role. The treasury is an account, not a key. */
export type RoleName = "admin" | "kyc" | "freeze" | "pause" | "wipe" | "supply";

/** An account created with an ECDSA key as its alias, so a browser wallet holding the key can act as it. */
export interface AccountRef {
  id: string;
  evm: string;
}

export interface Deployment {
  createdAt: string;
  issuerAccountId: string;
  issuerTreasury: string;
  routerId: string;
  router: string;
  factory: string;
  whbarToken: string;
  pair: string;
  settlementTokenId: string;
  settlementToken: string;
  assetTokenId: string;
  asset: string;
  sanad: string;
  sanadId: string;
  pricePerUnit: string;
  /** The account whose key is the asset's KYC key: the wallet that approves buyers. */
  complianceOfficer: AccountRef;
  buyers: { approved: AccountRef; unapproved: AccountRef };
}

/** Private keys for the demo role holders and buyers. Testnet throwaways. */
export type StoredKeys = Partial<Record<RoleName | "buyer.approved" | "buyer.unapproved", string>>;

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function readJson<T>(file: string): T {
  if (!fs.existsSync(file)) throw new Error(`${path.basename(file)} not found. Run \`yarn sanad:setup\` first.`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

/**
 * Decrypts the deployer key the same way `yarn hardhat:deploy` does, then finds the Hedera account
 * that key controls by asking the mirror node. Deriving the account id rather than configuring it
 * separately also proves the key really is the account's alias, which matters: HTS refuses
 * transfers to the long-zero address of an aliased account with INVALID_ALIAS_KEY (282).
 */
export async function issuer(): Promise<{
  client: Client;
  accountId: AccountId;
  key: PrivateKey;
  evmAddress: string;
}> {
  // The wrapper puts the key here, whether it came from OPERATOR_KEY or from decrypting. Reading
  // OPERATOR_KEY too means the script still works when run directly through hardhat.
  const supplied = process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY ?? process.env.OPERATOR_KEY;
  let hex: string;
  if (supplied?.trim()) {
    hex = supplied.trim();
  } else {
    const encrypted = process.env.DEPLOYER_PRIVATE_KEY_ENCRYPTED;
    if (!encrypted) {
      throw new Error(
        "No key. Set OPERATOR_KEY in packages/hardhat/.env for testnet, " +
          "or run `yarn hardhat:account:generate` / `yarn hardhat:account:import` for an encrypted one.",
      );
    }
    const pass = await password({ message: "Enter password to decrypt private key:" });
    hex = (await Wallet.fromEncryptedJson(encrypted, pass)).privateKey;
  }

  const key = PrivateKey.fromStringECDSA(hex.replace(/^0x/, ""));
  const evmAddress = "0x" + key.publicKey.toEvmAddress().replace(/^0x/, "");
  const account = await mirror<{ account: string; evm_address: string }>(`/api/v1/accounts/${evmAddress}`);
  if (account.evm_address?.toLowerCase() !== evmAddress.toLowerCase()) {
    throw new Error(
      `The deployer key's address (${evmAddress}) is not the alias of ${account.account}. ` +
        "Use an ECDSA account created from the Hedera Portal.",
    );
  }
  const accountId = AccountId.fromString(account.account);
  return { client: Client.forTestnet().setOperator(accountId, key), accountId, key, evmAddress };
}

/** GET from the mirror node, retrying while the record has not been ingested yet. */
export async function mirror<T>(route: string, { attempts = 20, delayMs = 1500 } = {}): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${MIRROR}${route}`);
    if (res.ok) return (await res.json()) as T;
    if (res.status !== 404) throw new Error(`Mirror node ${res.status} for ${route}: ${await res.text()}`);
    await sleep(delayMs);
  }
  throw new Error(`Mirror node never returned ${route}`);
}

export interface ContractResult {
  hash: string;
  result: string;
  error_message: string | null;
  /** What the call returned. For a direct system-contract call, the HTS response code. */
  call_result: string | null;
}

/**
 * Waits until the mirror node has ingested a contract transaction. JSON-RPC reads are served from
 * the mirror node, so reading state straight after a receipt can return stale values.
 */
export function waitForContractResult(hash: string): Promise<ContractResult> {
  return mirror<ContractResult>(`/api/v1/contracts/results/${hash}`);
}

export async function contractIdOf(evmAddress: string): Promise<string> {
  return (await mirror<{ contract_id: string }>(`/api/v1/contracts/${evmAddress}`)).contract_id;
}

export async function contractEvmAddress(contractId: string): Promise<string> {
  return (await mirror<{ evm_address: string }>(`/api/v1/contracts/${contractId}`)).evm_address;
}

export interface TokenRelationship {
  token_id: string;
  balance: number;
  kyc_status: "GRANTED" | "REVOKED" | "NOT_APPLICABLE";
  freeze_status: "FROZEN" | "UNFROZEN" | "NOT_APPLICABLE";
}

export async function tokenRelationship(accountId: string, tokenId: string): Promise<TokenRelationship | undefined> {
  const res = await mirror<{ tokens: TokenRelationship[] }>(`/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`);
  return res.tokens[0];
}

/** Polls until a token relationship matches, since SDK changes reach the mirror node a beat later. */
export async function waitForRelationship(
  accountId: string,
  tokenId: string,
  predicate: (rel: TokenRelationship | undefined) => boolean,
): Promise<TokenRelationship | undefined> {
  for (let i = 0; i < 20; i++) {
    const rel = await tokenRelationship(accountId, tokenId);
    if (predicate(rel)) return rel;
    await sleep(1500);
  }
  throw new Error(`Token relationship ${accountId}/${tokenId} never reached the expected state`);
}

/** Polls until the mirror node reports the token paused or unpaused. */
export async function waitForPauseStatus(tokenId: string, status: "PAUSED" | "UNPAUSED"): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const token = await mirror<{ pause_status: string }>(`/api/v1/tokens/${tokenId}`);
    if (token.pause_status === status) return;
    await sleep(1500);
  }
  throw new Error(`Token ${tokenId} never reached pause_status ${status}`);
}

/** Decodes mirror node revert data: our custom errors, or the router's Error(string). */
export function decodeRevert(errorMessage: string | null, iface: Interface): string {
  if (!errorMessage || !errorMessage.startsWith("0x")) return errorMessage ?? "(no revert data)";
  if (errorMessage.startsWith("0x08c379a0")) {
    const [reason] = AbiCoder.defaultAbiCoder().decode(["string"], "0x" + errorMessage.slice(10));
    return `Error("${reason}")`;
  }
  const parsed = iface.parseError(errorMessage);
  return parsed ? `${parsed.name}(${parsed.args.map(String).join(", ")})` : errorMessage;
}

export const mirrorTxUrl = (hash: string) => `${MIRROR}/api/v1/contracts/results/${hash}`;
export const hashscan = (kind: "token" | "contract" | "account", id: string) =>
  `https://hashscan.io/testnet/${kind}/${id}`;
