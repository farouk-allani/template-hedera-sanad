import { useQueries } from "@tanstack/react-query";
import type { Address } from "viem";
import { useMirror } from "~~/hooks/sanad/useMirror";
import type { Sale } from "~~/hooks/sanad/useSale";
import { MirrorAccount, TokenRelationship, accountRoute, mirrorGet, relationshipRoute } from "~~/utils/sanad/mirror";

export type Buyer = {
  id: string;
  /**
   * The address KYC calls name. For an aliased (ECDSA) account this is its alias: HTS refuses the
   * long-zero form of an aliased account with INVALID_ALIAS_KEY (282).
   */
  evmAddress: Address;
  /** Absent until the account associates with the asset. */
  relationship?: TokenRelationship;
};

/** An account and its standing with the asset, by account ID or EVM address. Null if no such account. */
async function fetchBuyer(idOrAddress: string, assetId: string): Promise<Buyer | null> {
  const [account, holdings] = await Promise.all([
    mirrorGet<MirrorAccount>(accountRoute(idOrAddress)),
    mirrorGet<{ tokens: TokenRelationship[] }>(relationshipRoute(idOrAddress, assetId)),
  ]);
  if (!account) return null;
  return { id: account.account, evmAddress: account.evm_address as Address, relationship: holdings?.tokens[0] };
}

export const buyerQuery = (idOrAddress: string, assetId: string) => ({
  queryKey: ["buyer", assetId, idOrAddress],
  queryFn: () => fetchBuyer(idOrAddress, assetId),
  refetchInterval: 15_000,
});

/**
 * The accounts associated with the asset, which is the only on-chain sign that someone wants it, and
 * a precondition for approval. The treasury and the sale hold the asset too and are left out.
 * Anyone can associate, so this lists who asked, not who has been verified.
 */
export function useBuyers(sale: Sale) {
  const treasury = sale.asset.token?.treasury_account_id;
  const holders = useMirror<{ balances: { account: string }[]; links: { next: string | null } }>(
    treasury && sale.contractId ? `/tokens/${sale.asset.id}/balances?limit=100` : undefined,
    15_000,
  );
  const ids = (holders.data?.balances ?? [])
    .map(holder => holder.account)
    .filter(id => id !== treasury && id !== sale.contractId);
  const buyers = useQueries({ queries: ids.map(id => buyerQuery(id, sale.asset.id)) });

  return {
    buyers: buyers.flatMap(query => (query.data ? [query.data] : [])),
    isLoading: holders.isPending || buyers.some(query => query.isPending),
    truncated: Boolean(holders.data?.links.next),
  };
}
