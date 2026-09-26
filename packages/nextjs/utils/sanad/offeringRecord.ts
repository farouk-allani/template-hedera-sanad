import { bytesToHex, hexToBytes } from "viem";
import record from "~~/contracts/offeringRecord.json";
import type { MirrorKey, MirrorToken } from "~~/utils/sanad/mirror";

/**
 * The asset's offering record: an HCS topic only the issuer can write to, with one message per sale
 * opened. `sanad:setup` and `sanad:deploy` publish to it and write its ID to offeringRecord.json.
 */
export const OFFERING_RECORD: { topicId: string; asset: string } = record;

export const KEY_ROLES = ["admin", "kyc", "freeze", "pause", "wipe", "supply"] as const;
export type KeyRole = (typeof KEY_ROLES)[number];

/** A sale as the issuer published it, with when that message reached consensus. */
export type PublishedSale = {
  sale: string;
  address: string;
  asset: string;
  settlement: string;
  pricePerUnit: string;
  treasury: string;
  router: string;
  keys: Record<KeyRole, string | null>;
  publishedAt: string;
};

export type TopicMessage = { consensus_timestamp: string; message: string };

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** Decodes one topic message. Anything that is not a well-formed sale-opened message is dropped. */
export function decodePublishedSale({ consensus_timestamp, message }: TopicMessage): PublishedSale | undefined {
  try {
    const bytes = Uint8Array.from(atob(message), char => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed?.type !== "sanad.sale-opened" || parsed.version !== 1 || typeof parsed.keys !== "object") return;
    const fields = [parsed.sale, parsed.address, parsed.asset, parsed.settlement, parsed.pricePerUnit, parsed.treasury];
    if (!fields.every(isText)) return;
    return { ...parsed, publishedAt: consensus_timestamp };
  } catch {
    return;
  }
}

/** SHA-256 of a key's bytes: the fingerprint the scripts publish, so the two can be compared. */
async function fingerprint(key: MirrorKey): Promise<string | null> {
  if (!key) return null;
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(hexToBytes(`0x${key.key}`)));
  return bytesToHex(new Uint8Array(digest)).slice(2);
}

/** The roles whose key is not the one the asset had when the sale was published. */
export async function keysChangedSince(published: PublishedSale, token: MirrorToken): Promise<KeyRole[]> {
  const current = await Promise.all(KEY_ROLES.map(role => fingerprint(token[`${role}_key`])));
  return KEY_ROLES.filter((role, i) => current[i] !== published.keys[role]);
}
