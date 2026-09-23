"use client";

import type { NextPage } from "next";
import { IssuerConsole } from "~~/app/issuer/_components/IssuerConsole";
import { Page } from "~~/components/sanad/Page";
import { SaleGate } from "~~/components/sanad/SaleGate";

const Issuer: NextPage = () => (
  <Page
    title="Issuer console"
    intro="Approve buyers with the asset's KYC key, take unsold inventory back, and see who controls the asset. Each action needs a specific key; the console checks which one your wallet holds before it offers the action."
  >
    <SaleGate>{sale => <IssuerConsole sale={sale} />}</SaleGate>
  </Page>
);

export default Issuer;
