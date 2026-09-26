"use client";

import Link from "next/link";
import { ExternalLink } from "~~/components/sanad/ExternalLink";
import { useOfferingRecord } from "~~/hooks/sanad/useOfferingRecord";
import type { Sale } from "~~/hooks/sanad/useSale";
import { useScaffoldReadContract } from "~~/hooks/scaffold-hbar";
import { formatHbar, formatToken, hashscan, shortHex } from "~~/utils/sanad/format";

/** Whether the issuer published this sale to the asset's offering record, in one line. */
const Published = ({ sale }: { sale: Sale }) => {
  const record = useOfferingRecord(sale);
  if (record.status === "loading") return <>…</>;
  if (record.status === "no-record") return <span className="opacity-70">No offering record</span>;
  if (record.status === "unpublished") {
    return (
      <Link href="/activity" className="link text-warning">
        Not in the issuer&apos;s offering record
      </Link>
    );
  }
  const concern = !record.termsMatch
    ? "terms differ from what was published"
    : record.changedKeys?.length
      ? "the asset's keys have changed since"
      : undefined;
  return (
    <>
      <ExternalLink href={hashscan.topic(record.topicId)}>In the offering record</ExternalLink>
      {concern && (
        <Link href="/activity" className="link text-warning block text-xs">
          {concern}
        </Link>
      )}
    </>
  );
};

/** The sale's terms and live state. Everything here is readable without a wallet. */
export const SaleTerms = ({ sale }: { sale: Sale }) => {
  const { data: unitQuote } = useScaffoldReadContract({
    contractName: "SanadSale",
    functionName: "quote",
    args: [1n],
  });
  const asset = sale.asset.token;
  const settlement = sale.settlement.token;

  return (
    <section className="card bg-base-100 border border-base-300 h-fit">
      <div className="card-body gap-3 text-sm">
        <h2 className="card-title text-base m-0">The sale</h2>
        {asset?.pause_status === "PAUSED" && <span className="badge badge-error">Paused by the issuer</span>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 m-0">
          <dt className="opacity-70">Asset</dt>
          <dd className="m-0">
            <ExternalLink href={hashscan.token(sale.asset.id)}>{asset ? asset.symbol : sale.asset.id}</ExternalLink>
            {asset && <div className="text-xs opacity-60">{asset.name}</div>}
          </dd>

          <dt className="opacity-70">Price</dt>
          <dd className="m-0">
            {settlement ? formatToken(sale.pricePerUnit, Number(settlement.decimals), settlement.symbol) : "…"} a unit
          </dd>

          <dt className="opacity-70">In HBAR now</dt>
          <dd className="m-0">{unitQuote ? `${formatHbar(unitQuote[0])} a unit` : "…"}</dd>

          <dt className="opacity-70">Left for sale</dt>
          <dd className="m-0">{sale.inventory === undefined ? "…" : `${sale.inventory} units`}</dd>

          <dt className="opacity-70">Issuer paid in</dt>
          <dd className="m-0">
            <ExternalLink href={hashscan.token(sale.settlement.id)}>
              {settlement ? settlement.symbol : sale.settlement.id}
            </ExternalLink>
          </dd>

          <dt className="opacity-70">Published</dt>
          <dd className="m-0">
            <Published sale={sale} />
          </dd>

          <dt className="opacity-70">Contract</dt>
          <dd className="m-0">
            {sale.contractId ? (
              <ExternalLink href={hashscan.contract(sale.contractId)}>{sale.contractId}</ExternalLink>
            ) : (
              shortHex(sale.address)
            )}
          </dd>
        </dl>
        <p className="m-0 text-xs opacity-60">
          The HBAR price comes from the SaucerSwap V1 pool and moves with every trade against it.
        </p>
      </div>
    </section>
  );
};
