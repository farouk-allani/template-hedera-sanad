"use client";

import { Suspense } from "react";
import { BuyersPanel } from "~~/app/issuer/_components/BuyersPanel";
import { InventoryPanel } from "~~/app/issuer/_components/InventoryPanel";
import { KeysPanel } from "~~/app/issuer/_components/KeysPanel";
import { RolePanel } from "~~/app/issuer/_components/RolePanel";
import type { Sale } from "~~/hooks/sanad/useSale";
import { useWalletRoles } from "~~/hooks/sanad/useWalletRoles";

export const IssuerConsole = ({ sale }: { sale: Sale }) => {
  const roles = useWalletRoles(sale);

  return (
    <div className="flex flex-col gap-6">
      <RolePanel sale={sale} roles={roles} />
      {/* The buyers panel reads ?account= from the URL, which Next.js requires inside a Suspense boundary. */}
      <Suspense fallback={<span className="loading loading-spinner loading-md" />}>
        <BuyersPanel sale={sale} canApprove={roles.holdsKycKey} />
      </Suspense>
      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <InventoryPanel sale={sale} owner={roles.isOwner ? roles.address : undefined} />
        <KeysPanel sale={sale} />
      </div>
    </div>
  );
};
