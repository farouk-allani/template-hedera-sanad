"use client";

import { type FormEvent, useState } from "react";
import { type Address, isAddress } from "viem";
import { usePublicClient } from "wagmi";
import { ErrorNotice } from "~~/components/sanad/ErrorNotice";
import type { Sale } from "~~/hooks/sanad/useSale";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { type Explanation, explainError } from "~~/utils/sanad/errors";
import { shortHex } from "~~/utils/sanad/format";

/** Unsold inventory can always come back out; otherwise an abandoned sale would strand it. */
export const InventoryPanel = ({ sale, owner }: { sale: Sale; owner?: Address }) => {
  const symbol = sale.asset.token?.symbol ?? "units";
  const [units, setUnits] = useState(1);
  const [recipient, setRecipient] = useState<string>(sale.issuerTreasury);
  const [problem, setProblem] = useState<{ explanation: Explanation; note?: string }>();
  const [withdrawn, setWithdrawn] = useState<number>();
  const publicClient = usePublicClient();
  const { writeContractAsync, isMining } = useScaffoldWriteContract({
    contractName: "SanadSale",
    disableSimulate: true,
  });

  const withdraw = async (event: FormEvent) => {
    event.preventDefault();
    if (!owner || !publicClient || !isAddress(recipient)) return;
    setProblem(undefined);
    setWithdrawn(undefined);
    const args = [recipient, BigInt(units)] as const;
    try {
      // The recipient's standing is checked by the network at transfer time: an account that is not
      // associated or not approved is refused with 184 or 176. Simulating first says so for free.
      await publicClient.simulateContract({
        address: sale.address,
        abi: sale.abi,
        functionName: "withdrawInventory",
        args,
        account: owner,
      });
    } catch (error) {
      setProblem({ explanation: explainError(error), note: "Nothing was sent." });
      return;
    }
    try {
      await writeContractAsync(
        { functionName: "withdrawInventory", args },
        { onBlockConfirmation: () => setWithdrawn(units) },
      );
    } catch (error) {
      setProblem({ explanation: explainError(error) });
    }
  };

  return (
    <section className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <h2 className="card-title text-base m-0">Inventory</h2>
        <p className="m-0 text-3xl font-semibold tabular-nums">
          {sale.inventory ?? "…"} <span className="text-base font-normal opacity-70">{symbol} left for sale</span>
        </p>
        {owner ? (
          <form className="flex flex-col gap-3" onSubmit={withdraw}>
            <div className="flex flex-wrap gap-4">
              <fieldset className="fieldset">
                <legend className="fieldset-legend">Units to take back</legend>
                <input
                  type="number"
                  min={1}
                  max={sale.inventory}
                  value={units}
                  onChange={event => setUnits(Math.max(1, Math.floor(Number(event.target.value)) || 1))}
                  className="input w-28"
                />
              </fieldset>
              <fieldset className="fieldset grow">
                <legend className="fieldset-legend">To</legend>
                <input
                  value={recipient}
                  onChange={event => setRecipient(event.target.value.trim())}
                  className="input w-full font-mono text-xs"
                  aria-invalid={!isAddress(recipient)}
                />
              </fieldset>
            </div>
            {problem && <ErrorNotice explanation={problem.explanation} note={problem.note} />}
            {withdrawn !== undefined && (
              <p role="status" className="m-0 text-sm text-success">
                {withdrawn} {symbol} left the sale.
              </p>
            )}
            <button type="submit" className="btn btn-primary w-fit" disabled={isMining || !isAddress(recipient)}>
              {isMining && <span className="loading loading-spinner loading-sm" />}
              Withdraw
            </button>
            <p className="m-0 text-xs opacity-60">
              The recipient must be associated with {symbol} and approved, or the network refuses the transfer. The
              default, the issuer&apos;s treasury, is both.
            </p>
          </form>
        ) : (
          <p className="m-0 text-sm opacity-70">
            Only the sale&apos;s owner, {shortHex(sale.owner)}, can take it back.
          </p>
        )}
      </div>
    </section>
  );
};
