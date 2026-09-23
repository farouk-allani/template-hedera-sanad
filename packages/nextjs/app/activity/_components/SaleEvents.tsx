"use client";

import type { ReactNode } from "react";
import { ExternalLink } from "~~/components/sanad/ExternalLink";
import type { Sale } from "~~/hooks/sanad/useSale";
import { useSaleEvents } from "~~/hooks/sanad/useSaleEvents";
import { formatHbar, formatTimestamp, formatToken, hashscan, shortHex } from "~~/utils/sanad/format";

/** Everything the sale contract itself recorded, newest first, each linked to its transaction. */
export const SaleEvents = ({ sale }: { sale: Sale }) => {
  const { events, isLoading, error } = useSaleEvents(sale);
  const symbol = sale.asset.token?.symbol ?? "units";
  const settlement = sale.settlement.token;

  const describe = (event: (typeof events)[number]): ReactNode => {
    switch (event.eventName) {
      case "Purchased":
        return (
          <>
            <Address value={event.args.buyer} /> bought {event.args.units.toString()} {symbol}. The pool took{" "}
            {formatHbar(event.args.hbarSpent)}, {formatHbar(event.args.hbarRefunded)} went back, and the issuer received{" "}
            {settlement
              ? formatToken(event.args.settlementPaid, Number(settlement.decimals), settlement.symbol)
              : event.args.settlementPaid.toString()}
            .
          </>
        );
      case "InventoryWithdrawn":
        return (
          <>
            {event.args.units.toString()} {symbol} taken back out of the sale, to <Address value={event.args.to} />.
          </>
        );
      case "HbarSwept":
        return (
          <>
            {formatHbar(event.args.amount)} that reached the sale outside a purchase recovered to{" "}
            <Address value={event.args.to} />.
          </>
        );
      case "AssetAssociated":
        return <>The sale associated itself with {symbol}, so it can hold inventory.</>;
    }
  };

  if (isLoading) return <span className="loading loading-spinner loading-md" />;
  if (error) return <p className="m-0 text-sm text-error">The mirror node could not be reached: {error.message}</p>;
  if (events.length === 0) return <p className="m-0 text-sm">Nothing has happened in this sale yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>What happened</th>
            <th className="text-right">Transaction</th>
          </tr>
        </thead>
        <tbody>
          {events.map(event => (
            <tr key={event.key}>
              <td className="whitespace-nowrap align-top">{formatTimestamp(event.timestamp)}</td>
              <td>{describe(event)}</td>
              <td className="text-right align-top whitespace-nowrap">
                <ExternalLink href={hashscan.transaction(event.hash)}>{shortHex(event.hash)}</ExternalLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Address = ({ value }: { value: string }) => (
  <ExternalLink href={hashscan.address(value)}>
    <span className="font-mono">{shortHex(value)}</span>
  </ExternalLink>
);
