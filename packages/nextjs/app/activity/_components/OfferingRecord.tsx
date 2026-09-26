"use client";

import type { ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { ExternalLink } from "~~/components/sanad/ExternalLink";
import { type RecordCheck, useOfferingRecord } from "~~/hooks/sanad/useOfferingRecord";
import type { Sale } from "~~/hooks/sanad/useSale";
import { formatTimestamp, formatToken, hashscan } from "~~/utils/sanad/format";
import { type TokenRelationship, mirrorGet, relationshipRoute } from "~~/utils/sanad/mirror";
import type { PublishedSale } from "~~/utils/sanad/offeringRecord";

/** Every sale the issuer published for the asset, and how the live sale compares with its entry. */
export const OfferingRecord = ({ sale }: { sale: Sale }) => {
  const record = useOfferingRecord(sale);
  const symbol = sale.asset.token?.symbol ?? "the asset";

  return (
    <section className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <h2 className="card-title text-base m-0">Offering record</h2>
        {record.status === "no-record" ? (
          <p className="m-0 text-sm">
            {symbol} has no offering record configured. <code>yarn sanad:setup</code> and <code>yarn sanad:deploy</code>{" "}
            create one.
          </p>
        ) : record.status === "loading" ? (
          <span className="loading loading-spinner loading-md" />
        ) : (
          <>
            <p className="m-0 text-sm opacity-70">
              Every sale the issuer has opened for {symbol}, as published to Hedera Consensus Service topic{" "}
              <ExternalLink href={hashscan.topic(record.topicId)}>{record.topicId}</ExternalLink>. Only the issuer can
              write to it, and nobody can edit or delete what it holds.
            </p>
            <Checks sale={sale} record={record} />
            <PublishedSales sale={sale} sales={record.sales} />
            {record.truncated && (
              <p className="m-0 text-xs opacity-60">
                Only the topic&apos;s first 1,000 messages were read. A record holds one message per sale, so a topic
                this long is probably not an offering record.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
};

const Check = ({ ok, children }: { ok: boolean | undefined; children: ReactNode }) => (
  <li className="flex gap-2 items-start">
    {ok === undefined ? (
      <span className="loading loading-spinner loading-xs mt-0.5" />
    ) : ok ? (
      <CheckCircleIcon className="h-5 w-5 shrink-0 text-success" aria-label="Yes" />
    ) : (
      <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-warning" aria-label="No" />
    )}
    <span>{children}</span>
  </li>
);

const Checks = ({
  sale,
  record,
}: {
  sale: Sale;
  record: Extract<RecordCheck, { status: "unpublished" | "published" }>;
}) => {
  if (record.status === "unpublished") {
    return (
      <ul className="m-0 p-0 list-none text-sm">
        <Check ok={false}>
          The issuer has not published the sale this app points at, {sale.contractId ?? sale.address}. Check with the
          issuer before buying from it.
        </Check>
      </ul>
    );
  }
  const changed = record.changedKeys;
  return (
    <ul className="m-0 p-0 list-none text-sm flex flex-col gap-1">
      <Check ok>The issuer published this sale on {formatTimestamp(record.entry.publishedAt)}.</Check>
      <Check ok={record.termsMatch}>
        {record.termsMatch
          ? "Its terms are the ones published: asset, settlement token, price and who is paid."
          : "Its terms differ from what was published. Check with the issuer before buying."}
      </Check>
      <Check ok={changed === undefined ? undefined : changed !== null && changed.length === 0}>
        {changed === undefined
          ? "Comparing the asset's keys with the ones published…"
          : changed === null
            ? "This browser cannot compare the asset's keys with the ones published: it needs HTTPS or localhost."
            : changed.length === 0
              ? "The asset's keys are the ones it had then."
              : `Since then, the asset's ${changed.join(", ")} ${changed.length === 1 ? "key has" : "keys have"} changed.`}
      </Check>
    </ul>
  );
};

const PublishedSales = ({ sale, sales }: { sale: Sale; sales: PublishedSale[] }) => {
  const holdings = useQueries({
    queries: sales.map(published => ({
      queryKey: ["mirror", relationshipRoute(published.sale, sale.asset.id)],
      queryFn: () => mirrorGet<{ tokens: TokenRelationship[] }>(relationshipRoute(published.sale, sale.asset.id)),
    })),
  });
  const settlement = sale.settlement.token;
  const symbol = sale.asset.token?.symbol ?? "units";

  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Published</th>
            <th>Sale</th>
            <th>Price a unit</th>
            <th>Holds now</th>
          </tr>
        </thead>
        <tbody>
          {[...sales].reverse().map(published => {
            const index = sales.indexOf(published);
            const current = published.address === sale.address.toLowerCase();
            const units = holdings[index]?.data?.tokens[0]?.balance;
            return (
              <tr key={published.sale}>
                <td>{formatTimestamp(published.publishedAt)}</td>
                <td>
                  <ExternalLink href={hashscan.contract(published.sale)}>{published.sale}</ExternalLink>
                  {current && <span className="badge badge-primary badge-sm ml-2">this sale</span>}
                </td>
                <td>
                  {settlement && published.settlement === sale.settlement.id
                    ? formatToken(BigInt(published.pricePerUnit), Number(settlement.decimals), settlement.symbol)
                    : `${published.pricePerUnit} base units of ${published.settlement}`}
                </td>
                <td>{units === undefined ? "…" : `${units} ${symbol}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
