import { type Hex, decodeEventLog } from "viem";
import { useMirror } from "~~/hooks/sanad/useMirror";
import type { Sale } from "~~/hooks/sanad/useSale";
import type { MirrorLog } from "~~/utils/sanad/mirror";

/** The sale's own events, newest first, read from the mirror node and decoded with the sale's ABI. */
export function useSaleEvents(sale: Sale) {
  const logs = useMirror<{ logs: MirrorLog[] }>(`/contracts/${sale.address}/results/logs?order=desc&limit=50`, 15_000);

  // The ABI and the address come from the same deployment record, so every log here decodes.
  const events = (logs.data?.logs ?? []).map(log => ({
    ...decodeEventLog({ abi: sale.abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] }),
    timestamp: log.timestamp,
    hash: log.transaction_hash,
    key: `${log.transaction_hash}-${log.index}`,
  }));

  return { events, isLoading: logs.isPending, error: logs.error };
}
