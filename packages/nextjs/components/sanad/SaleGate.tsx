"use client";

import type { ReactNode } from "react";
import { hederaTestnet } from "viem/chains";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { type Sale, useSale } from "~~/hooks/sanad/useSale";
import { contracts } from "~~/utils/scaffold-hbar/contract";

/** Renders its children with the deployed sale, or explains why there is none to show. */
export const SaleGate = ({ children }: { children: (sale: Sale) => ReactNode }) => {
  const state = useSale();

  if (state.status === "loading") {
    return (
      <div className="flex justify-center py-16" aria-label="Loading the sale">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }
  if (state.status === "missing") return <NoSale />;
  return <>{children(state.sale)}</>;
};

const NoSale = () => (
  <div role="alert" className="alert alert-warning alert-soft items-start">
    <ExclamationTriangleIcon className="h-6 w-6 shrink-0 text-warning" />
    <div className="flex flex-col gap-2 text-base-content">
      <p className="font-semibold m-0">No sale found on Hedera Testnet</p>
      <p className="m-0 text-sm">
        The app points at <code className="break-all">{contracts?.[hederaTestnet.id]?.SanadSale?.address}</code> and
        there is no contract there, or the network could not be reached. Testnet is reset from time to time, which
        removes every contract on it.
      </p>
      <p className="m-0 text-sm">
        To deploy your own sale, set <code>OPERATOR_KEY</code> in <code>packages/hardhat/.env</code> and run the{" "}
        <code>sanad:setup</code> script. It points the app at the new sale.
      </p>
    </div>
  </div>
);
