"use client";

import { useState } from "react";
import { type Address, type Hex, type TransactionReceipt, parseEventLogs } from "viem";
import { useBalance, usePublicClient } from "wagmi";
import { ErrorNotice } from "~~/components/sanad/ErrorNotice";
import { ExternalLink } from "~~/components/sanad/ExternalLink";
import type { Sale } from "~~/hooks/sanad/useSale";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { type Explanation, explainError } from "~~/utils/sanad/errors";
import { WEIBARS_PER_TINYBAR, formatHbar, formatToken, hashscan } from "~~/utils/sanad/format";

/** How long the sale honours the price once Buy is pressed. The contract enforces it as `deadline`. */
const QUOTE_VALIDITY_SECONDS = 120;

/** Headroom above the quote, in basis points, for trades that move the pool before this one lands. */
const TOLERANCES_BPS = [50, 100, 300];

/** A wallet sets aside gas limit × maximum fee per gas before sending; half an HBAR covers a purchase. */
const FEE_RESERVE_TINYBARS = 50_000_000n;

/** Above this, the pool is shallow enough for the order size to matter, and the buyer is told so. */
const PRICE_IMPACT_WARNING_BPS = 500n;

type Purchase = { units: bigint; hbarSpent: bigint; hbarRefunded: bigint; settlementPaid: bigint; hash: Hex };

export const PurchaseForm = ({ sale, buyer }: { sale: Sale; buyer: Address }) => {
  const [units, setUnits] = useState(1);
  const [toleranceBps, setToleranceBps] = useState(100);
  const [problem, setProblem] = useState<{ explanation: Explanation; note?: string }>();
  const [purchase, setPurchase] = useState<Purchase>();

  const publicClient = usePublicClient();
  const { data: balance } = useBalance({ address: buyer });
  const quote = useScaffoldReadContract({ contractName: "SanadSale", functionName: "quote", args: [BigInt(units)] });
  const unitQuote = useScaffoldReadContract({ contractName: "SanadSale", functionName: "quote", args: [1n] });
  const { writeContractAsync, isMining } = useScaffoldWriteContract({
    contractName: "SanadSale",
    disableSimulate: true,
  });

  const symbol = sale.asset.token?.symbol ?? "units";
  const settlement = sale.settlement.token;
  const hbarRequired = quote.data?.[0];
  // Rounded up, so the budget is never a tinybar short of the tolerance it promises.
  const maxSpend =
    hbarRequired === undefined ? undefined : (hbarRequired * (10_000n + BigInt(toleranceBps)) + 9_999n) / 10_000n;
  const impactBps =
    hbarRequired !== undefined && unitQuote.data && units > 1
      ? (hbarRequired * 10_000n) / (unitQuote.data[0] * BigInt(units)) - 10_000n
      : 0n;
  const overInventory = sale.inventory !== undefined && units > sale.inventory;
  const shortOfHbar =
    maxSpend !== undefined &&
    balance !== undefined &&
    balance.value < (maxSpend + FEE_RESERVE_TINYBARS) * WEIBARS_PER_TINYBAR;

  const readPurchase = (receipt: TransactionReceipt): Purchase | undefined => {
    const [event] = parseEventLogs({ abi: sale.abi, logs: receipt.logs, eventName: "Purchased" });
    return event && { ...event.args, units: BigInt(event.args.units), hash: receipt.transactionHash };
  };

  const buy = async () => {
    if (maxSpend === undefined || !publicClient) return;
    setProblem(undefined);
    setPurchase(undefined);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + QUOTE_VALIDITY_SECONDS);
    const args = [BigInt(units), deadline] as const;
    const value = maxSpend * WEIBARS_PER_TINYBAR;

    try {
      // Simulated as the buyer, so the network's own refusals (not approved, frozen, paused, price
      // moved) surface here, before anything is signed or paid for.
      await publicClient.simulateContract({
        address: sale.address,
        abi: sale.abi,
        functionName: "buy",
        args,
        value,
        account: buyer,
      });
    } catch (error) {
      setProblem({ explanation: explainError(error), note: "Nothing was sent." });
      return;
    }

    try {
      await writeContractAsync(
        { functionName: "buy", args, value },
        { onBlockConfirmation: receipt => setPurchase(readPurchase(receipt)) },
      );
    } catch (error) {
      setProblem({ explanation: explainError(error) });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-6">
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Units</legend>
          <input
            type="number"
            min={1}
            max={sale.inventory}
            step={1}
            value={units}
            onChange={event => setUnits(Math.max(1, Math.floor(Number(event.target.value)) || 1))}
            className="input w-32"
          />
        </fieldset>
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Price tolerance</legend>
          <div className="join">
            {TOLERANCES_BPS.map(bps => (
              <button
                key={bps}
                type="button"
                className={`btn btn-sm join-item ${bps === toleranceBps ? "btn-active btn-primary" : ""}`}
                onClick={() => setToleranceBps(bps)}
              >
                {bps / 100}%
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {quote.error ? (
        <ErrorNotice
          explanation={{
            title: `The pool cannot supply the ${settlement?.symbol ?? "settlement token"} for ${units} units.`,
            action: "Try fewer units. The demo pool is small on purpose.",
          }}
        />
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm m-0">
          <dt className="opacity-70">The pool asks</dt>
          <dd className="m-0 tabular-nums">{hbarRequired === undefined ? "…" : formatHbar(hbarRequired)}</dd>
          <dt className="opacity-70">You pay at most</dt>
          <dd className="m-0 tabular-nums font-semibold">{maxSpend === undefined ? "…" : formatHbar(maxSpend)}</dd>
          <dt className="opacity-70">The issuer receives</dt>
          <dd className="m-0 tabular-nums">
            {quote.data && settlement
              ? formatToken(quote.data[1], Number(settlement.decimals), settlement.symbol)
              : "…"}
          </dd>
        </dl>
      )}

      {impactBps > PRICE_IMPACT_WARNING_BPS && (
        <div role="alert" className="alert alert-warning alert-soft text-sm text-base-content">
          The pool is shallow: {units} units cost {(Number(impactBps) / 100).toFixed(1)}% more per unit than one does.
        </div>
      )}
      {overInventory && (
        <div role="alert" className="alert alert-warning alert-soft text-sm text-base-content">
          The sale holds {sale.inventory} units. Ask for fewer.
        </div>
      )}
      {shortOfHbar && balance && (
        <div role="alert" className="alert alert-warning alert-soft text-sm text-base-content">
          Your balance is {formatHbar(balance.value / WEIBARS_PER_TINYBAR)}. This purchase needs up to{" "}
          {maxSpend !== undefined && formatHbar(maxSpend)} plus the network fee.
        </div>
      )}
      {problem && <ErrorNotice explanation={problem.explanation} note={problem.note} />}

      <button
        type="button"
        className="btn btn-primary w-fit"
        disabled={maxSpend === undefined || Boolean(quote.error) || overInventory || shortOfHbar || isMining}
        onClick={buy}
      >
        {isMining && <span className="loading loading-spinner loading-sm" />}
        Buy {units} {symbol}
        {maxSpend !== undefined && ` for at most ${formatHbar(maxSpend)}`}
      </button>
      <p className="m-0 text-xs opacity-60">
        Once you press Buy, the price holds for two minutes. If your wallet sends later than that, the sale refuses the
        purchase and only the network fee is spent. Whatever the pool does not take comes back in the same transaction.
      </p>

      {purchase && (
        <div role="status" className="alert alert-success alert-soft items-start">
          <div className="flex flex-col gap-1 text-sm text-base-content">
            <p className="font-semibold m-0">
              You bought {purchase.units.toString()} {symbol}.
            </p>
            <p className="m-0">
              The pool took {formatHbar(purchase.hbarSpent)}, {formatHbar(purchase.hbarRefunded)} came back, and the
              issuer received{" "}
              {settlement
                ? formatToken(purchase.settlementPaid, Number(settlement.decimals), settlement.symbol)
                : purchase.settlementPaid.toString()}
              . All of it happened in one transaction.
            </p>
            <ExternalLink href={hashscan.transaction(purchase.hash)}>See it on HashScan</ExternalLink>
          </div>
        </div>
      )}
    </div>
  );
};
