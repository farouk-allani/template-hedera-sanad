/**
 * The asset's offering record: a Hedera Consensus Service topic that only the issuer can write to,
 * holding one message per sale opened for the asset. The app reads it to list the asset's sales,
 * to check the live sale against what was published, and to show whether the asset's keys have
 * changed since.
 *
 * It records what the issuer published. It is not a history of approvals, and a message is posted
 * after a sale is stocked, not atomically with anything.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client, PublicKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { hashscan, mirror } from "./hedera";

/** Committed with the deployment record, so a fresh scaffold finds the demo's record. */
export const RECORD_FILE = path.resolve(__dirname, "..", "..", "..", "nextjs", "contracts", "offeringRecord.json");

const KEY_ROLES = ["admin", "kyc", "freeze", "pause", "wipe", "supply"] as const;

type MirrorKey = { _type: string; key: string } | null;

type MirrorToken = { token_id: string; symbol: string } & Record<`${(typeof KEY_ROLES)[number]}_key`, MirrorKey>;

/** One sale, as the issuer published it. Amounts are strings because JSON has no 64-bit integers. */
export type SaleOpened = {
  type: "sanad.sale-opened";
  version: 1;
  sale: string;
  address: string;
  asset: string;
  settlement: string;
  pricePerUnit: string;
  treasury: string;
  router: string;
  /** SHA-256 of each role key's bytes as the mirror node reports them, or null for no key. */
  keys: Record<(typeof KEY_ROLES)[number], string | null>;
};

type RecordFile = { topicId: string; asset: string };

/**
 * A fingerprint rather than the key itself: a key list can run to hundreds of bytes, and a topic
 * message is limited to 1,024. The app computes the same digest to compare.
 */
const fingerprint = (key: MirrorKey) =>
  key ? crypto.createHash("sha256").update(Buffer.from(key.key, "hex")).digest("hex") : null;

/** A record holds one message per sale, so ten pages of a hundred is far beyond any real one. */
const MAX_PAGES = 10;

async function publishedSales(topicId: string): Promise<SaleOpened[]> {
  const sales: SaleOpened[] = [];
  let route: string | null = `/api/v1/topics/${topicId}/messages?limit=100`;
  for (let pages = 0; route && pages < MAX_PAGES; pages++) {
    const page: { messages: { message: string }[]; links: { next: string | null } } = await mirror(route);
    for (const { message } of page.messages) {
      try {
        const parsed = JSON.parse(Buffer.from(message, "base64").toString("utf8"));
        if (parsed.type === "sanad.sale-opened") sales.push(parsed);
      } catch {
        // Only the issuer can write here, but a message that is not ours is skipped, not fatal.
      }
    }
    route = page.links.next;
  }
  return sales;
}

/**
 * Publishes a sale to its asset's record, creating the record first if the asset has none yet.
 * Safe to call again: a sale already in the record is not published twice.
 */
export async function recordSaleOpened(
  client: Client,
  issuerKey: PublicKey,
  sale: Omit<SaleOpened, "type" | "version" | "keys">,
): Promise<string> {
  const token = await mirror<MirrorToken>(`/api/v1/tokens/${sale.asset}`);
  const existing: RecordFile | undefined = fs.existsSync(RECORD_FILE)
    ? JSON.parse(fs.readFileSync(RECORD_FILE, "utf8"))
    : undefined;

  let topicId = existing?.asset === sale.asset ? existing.topicId : undefined;
  if (!topicId) {
    // No admin key: once created, nobody can edit or delete the record. The submit key is the
    // issuer's, so only the issuer can add to it. The SDK makes the payer the auto-renew account.
    const receipt = await (
      await new TopicCreateTransaction()
        .setTopicMemo(`Sanad offering record for ${token.symbol} ${token.token_id}`)
        .setSubmitKey(issuerKey)
        .execute(client)
    ).getReceipt(client);
    topicId = receipt.topicId!.toString();
    fs.writeFileSync(RECORD_FILE, JSON.stringify({ topicId, asset: sale.asset } satisfies RecordFile, null, 2) + "\n");
    console.log(`  created the offering record for ${token.symbol}: ${hashscan("topic", topicId)}`);
  }

  if ((await publishedSales(topicId)).some(published => published.sale === sale.sale)) {
    console.log(`  ${sale.sale} is already in the offering record ${topicId}`);
    return topicId;
  }
  const message: SaleOpened = {
    type: "sanad.sale-opened",
    version: 1,
    ...sale,
    keys: Object.fromEntries(KEY_ROLES.map(role => [role, fingerprint(token[`${role}_key`])])) as SaleOpened["keys"],
  };
  const receipt = await (
    await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(JSON.stringify(message)).execute(client)
  ).getReceipt(client);
  console.log(`  published ${sale.sale} to the offering record ${topicId}, message ${receipt.topicSequenceNumber}`);
  return topicId;
}
