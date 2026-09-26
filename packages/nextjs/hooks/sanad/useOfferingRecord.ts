import { useQuery } from "@tanstack/react-query";
import type { Sale } from "~~/hooks/sanad/useSale";
import { mirrorGet } from "~~/utils/sanad/mirror";
import {
  KEY_ROLES,
  type KeyRole,
  OFFERING_RECORD,
  type PublishedSale,
  type TopicMessage,
  decodePublishedSale,
  keysChangedSince,
} from "~~/utils/sanad/offeringRecord";

type MessagesPage = { messages: TopicMessage[]; links: { next: string | null } };

/** A record holds one message per sale. Reading stops here so a wrong topic ID cannot stall the page. */
const MAX_PAGES = 10;

async function fetchPublishedSales(topicId: string): Promise<{ sales: PublishedSale[]; truncated: boolean }> {
  const sales: PublishedSale[] = [];
  let route: string | null = `/topics/${topicId}/messages?limit=100`;
  for (let pages = 0; route && pages < MAX_PAGES; pages++) {
    const page: MessagesPage | null = await mirrorGet<MessagesPage>(route);
    if (!page) break;
    for (const message of page.messages) {
      const published = decodePublishedSale(message);
      // The scripts publish a sale once. Were it ever published twice, the first message stands.
      if (published && !sales.some(known => known.sale === published.sale)) sales.push(published);
    }
    route = page.links.next?.replace(/^\/api\/v1/, "") ?? null;
  }
  return { sales, truncated: route !== null };
}

/** Every sale published to the asset's offering record, oldest first. No topic if the asset has none. */
export function usePublishedSales(assetId: string) {
  const topicId = OFFERING_RECORD.asset === assetId ? OFFERING_RECORD.topicId : undefined;
  const query = useQuery({
    queryKey: ["offering-record", topicId],
    queryFn: () => fetchPublishedSales(topicId as string),
    enabled: topicId !== undefined,
  });
  return {
    topicId,
    sales: query.data?.sales,
    truncated: query.data?.truncated ?? false,
    isPending: topicId !== undefined && query.isPending,
  };
}

export type RecordCheck =
  | { status: "loading" }
  | { status: "no-record" }
  | { status: "unpublished"; topicId: string; sales: PublishedSale[]; truncated: boolean }
  | {
      status: "published";
      topicId: string;
      sales: PublishedSale[];
      truncated: boolean;
      entry: PublishedSale;
      termsMatch: boolean;
      /**
       * Undefined until the fingerprints are computed; null if this browser cannot compute them
       * (SHA-256 needs a secure context: HTTPS, or localhost).
       */
      changedKeys: KeyRole[] | null | undefined;
    };

/**
 * Checks the live sale against the asset's offering record: whether the issuer published it, whether
 * its terms are the ones published, and whether the asset's keys have changed since.
 */
export function useOfferingRecord(sale: Sale): RecordCheck {
  const { topicId, sales, truncated, isPending } = usePublishedSales(sale.asset.id);
  const entry = sales?.find(published => published.address === sale.address.toLowerCase());
  const token = sale.asset.token;
  const changedKeys = useQuery({
    queryKey: ["offering-record-keys", entry?.sale, ...KEY_ROLES.map(role => token?.[`${role}_key`]?.key ?? null)],
    queryFn: () => keysChangedSince(entry as PublishedSale, token!),
    enabled: entry !== undefined && token !== undefined,
  });

  if (!topicId) return { status: "no-record" };
  if (isPending || !sales) return { status: "loading" };
  if (!entry) return { status: "unpublished", topicId, sales, truncated };
  return {
    status: "published",
    topicId,
    sales,
    truncated,
    entry,
    termsMatch:
      entry.asset === sale.asset.id &&
      entry.settlement === sale.settlement.id &&
      entry.pricePerUnit === sale.pricePerUnit.toString() &&
      entry.treasury === sale.issuerTreasury.toLowerCase(),
    changedKeys: changedKeys.isError ? null : changedKeys.data,
  };
}
