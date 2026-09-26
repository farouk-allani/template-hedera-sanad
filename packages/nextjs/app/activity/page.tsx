"use client";

import type { NextPage } from "next";
import { OfferingRecord } from "~~/app/activity/_components/OfferingRecord";
import { SaleEvents } from "~~/app/activity/_components/SaleEvents";
import { BuyersTable } from "~~/components/sanad/BuyersTable";
import { Page } from "~~/components/sanad/Page";
import { SaleGate } from "~~/components/sanad/SaleGate";
import { useBuyers } from "~~/hooks/sanad/useBuyers";
import { type Sale } from "~~/hooks/sanad/useSale";

const Activity: NextPage = () => (
  <Page
    title="Activity"
    intro="What the sale contract recorded, what the issuer published about it, and where every buyer stands right now, all read from the Hedera mirror node. Each entry links to HashScan."
  >
    <SaleGate>
      {sale => (
        <>
          <section className="card bg-base-100 border border-base-300">
            <div className="card-body gap-3">
              <h2 className="card-title text-base m-0">Sale history</h2>
              <SaleEvents sale={sale} />
            </div>
          </section>
          <OfferingRecord sale={sale} />
          <Standing sale={sale} />
        </>
      )}
    </SaleGate>
  </Page>
);

const Standing = ({ sale }: { sale: Sale }) => {
  const { buyers, isLoading } = useBuyers(sale);
  return (
    <section className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <h2 className="card-title text-base m-0">Buyers now</h2>
        <p className="m-0 text-sm opacity-70">
          Approvals and revocations have no history here. They are token operations, not sale events, and the mirror
          node cannot list them by token: its record of each one names the account, not the asset. What it can show
          reliably is where every buyer stands now.
        </p>
        {isLoading ? (
          <span className="loading loading-spinner loading-md" />
        ) : buyers.length === 0 ? (
          <p className="m-0 text-sm">No account has associated with the asset yet.</p>
        ) : (
          <BuyersTable buyers={buyers} assetSymbol={sale.asset.token?.symbol} />
        )}
      </div>
    </section>
  );
};

export default Activity;
