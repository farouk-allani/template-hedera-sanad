"use client";

import type { NextPage } from "next";
import { BuyFlow } from "~~/app/buy/_components/BuyFlow";
import { Page } from "~~/components/sanad/Page";
import { SaleGate } from "~~/components/sanad/SaleGate";
import { SaleTerms } from "~~/components/sanad/SaleTerms";

const Buy: NextPage = () => (
  <Page
    title="Buy"
    intro="Pay in HBAR. SaucerSwap converts exactly enough of it to pay the issuer, and the asset reaches you in the same transaction. If the network refuses to deliver it, the payment is undone too."
  >
    <SaleGate>
      {sale => (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem] items-start">
          <BuyFlow sale={sale} />
          <SaleTerms sale={sale} />
        </div>
      )}
    </SaleGate>
  </Page>
);

export default Buy;
