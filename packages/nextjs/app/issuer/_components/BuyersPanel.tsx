"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAddress } from "viem";
import { BuyersTable } from "~~/components/sanad/BuyersTable";
import { type Buyer, buyerQuery, useBuyers } from "~~/hooks/sanad/useBuyers";
import { useHtsCalls } from "~~/hooks/sanad/useHtsCalls";
import type { Sale } from "~~/hooks/sanad/useSale";
import { type Explanation, explainError, explainKycResponse } from "~~/utils/sanad/errors";
import { SUCCESS } from "~~/utils/sanad/hts";
import { TokenRelationship, relationshipRoute, waitForMirror } from "~~/utils/sanad/mirror";

const ACCOUNT_ID = /^0\.0\.\d+$/;

export const BuyersPanel = ({ sale, canApprove }: { sale: Sale; canApprove: boolean }) => {
  const { buyers, isLoading, truncated } = useBuyers(sale);
  const symbol = sale.asset.token?.symbol;
  const action = canApprove ? (buyer: Buyer) => <KycAction sale={sale} buyer={buyer} /> : undefined;

  return (
    <section className="card bg-base-100 border border-base-300">
      <div className="card-body gap-4">
        <h2 className="card-title text-base m-0">Buyers</h2>
        <p className="m-0 text-sm opacity-70">
          Accounts that have associated with {symbol}. Associating is how a buyer asks, and anyone can do it, so this
          lists who asked, not who has been checked. Checking who a buyer is happens outside the ledger; approving
          records the decision on it.
        </p>
        <Lookup sale={sale} action={action} />
        <h3 className="m-0 text-sm font-semibold">Every associated account</h3>
        {isLoading ? (
          <span className="loading loading-spinner loading-md" />
        ) : buyers.length === 0 ? (
          <p className="m-0 text-sm">No account has associated with {symbol} yet.</p>
        ) : (
          <BuyersTable buyers={buyers} assetSymbol={symbol} action={action} />
        )}
        {truncated && <p className="m-0 text-xs opacity-60">Showing the first 100 accounts.</p>}
      </div>
    </section>
  );
};

/** Finds one account by ID or EVM address, for a buyer who sent theirs, or opened a shared link. */
const Lookup = ({ sale, action }: { sale: Sale; action?: (buyer: Buyer) => ReactNode }) => {
  const shared = useSearchParams().get("account") ?? "";
  const [input, setInput] = useState(shared);
  const [search, setSearch] = useState(shared);
  const valid = ACCOUNT_ID.test(search) || isAddress(search);
  const result = useQuery({ ...buyerQuery(search, sale.asset.id), enabled: valid });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSearch(input.trim());
  };

  return (
    <div className="flex flex-col gap-2">
      <form className="join" onSubmit={submit}>
        <input
          className="input join-item w-72"
          placeholder="0.0.12345 or 0x…"
          value={input}
          onChange={event => setInput(event.target.value)}
          aria-label="Account ID or EVM address"
        />
        <button type="submit" className="btn join-item">
          Look up
        </button>
      </form>
      {search !== "" && !valid && (
        <p className="m-0 text-sm text-error">Enter an account ID such as 0.0.12345, or an EVM address.</p>
      )}
      {valid && result.data === null && <p className="m-0 text-sm">There is no such account on Hedera Testnet.</p>}
      {result.data && (
        <div className="rounded-box border border-primary/40">
          <BuyersTable buyers={[result.data]} assetSymbol={sale.asset.token?.symbol} action={action} />
        </div>
      )}
    </div>
  );
};

/**
 * Approves or revokes one buyer. The call goes straight to the HTS system contract, whose refusal
 * is a returned code inside a successful transaction, so success is judged by that code and then
 * by the mirror node showing the new KYC status.
 */
const KycAction = ({ sale, buyer }: { sale: Sale; buyer: Buyer }) => {
  const { grantKyc, revokeKyc } = useHtsCalls();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Explanation>();

  if (!buyer.relationship) return <span className="text-xs opacity-60">Must associate first</span>;
  const approve = buyer.relationship.kyc_status !== "GRANTED";

  const run = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      const change = approve ? grantKyc : revokeKyc;
      const { code, result } = await change(sale.asset.address, buyer.evmAddress);
      if (code !== SUCCESS) {
        setProblem(
          code === undefined
            ? { title: `The transaction failed: ${result}.`, action: "Try again. If it keeps failing, check HashScan." }
            : explainKycResponse(code),
        );
        return;
      }
      const target = approve ? "GRANTED" : "REVOKED";
      const shown = await waitForMirror<{ tokens: TokenRelationship[] }>(
        relationshipRoute(buyer.id, sale.asset.id),
        data => data?.tokens[0]?.kyc_status === target,
      );
      if (!shown) {
        setProblem({
          title: "The network accepted the change, but the mirror node does not show it yet.",
          action: "Refresh in a minute.",
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["buyer", sale.asset.id] });
    } catch (error) {
      setProblem(explainError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className={`btn btn-sm ${approve ? "btn-primary" : "btn-outline"}`}
        disabled={busy}
        onClick={run}
      >
        {busy && <span className="loading loading-spinner loading-xs" />}
        {approve ? "Approve" : "Revoke"}
      </button>
      {problem && (
        <p className="m-0 max-w-xs text-right text-xs text-error">
          {problem.title} {problem.action}
        </p>
      )}
    </div>
  );
};
