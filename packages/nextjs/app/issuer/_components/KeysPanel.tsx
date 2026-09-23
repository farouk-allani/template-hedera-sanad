"use client";

import { ExternalLink } from "~~/components/sanad/ExternalLink";
import type { Sale } from "~~/hooks/sanad/useSale";
import { useKeyHolder } from "~~/hooks/sanad/useWalletRoles";
import { hashscan, shortHex } from "~~/utils/sanad/format";
import type { MirrorKey } from "~~/utils/sanad/mirror";

const ROLES = [
  { field: "admin_key", name: "Admin", power: "Change the token's other keys, including replacing all of these" },
  { field: "kyc_key", name: "KYC", power: "Approve or un-approve any account, at any time" },
  { field: "freeze_key", name: "Freeze", power: "Freeze a holder, blocking transfers in and out" },
  { field: "pause_key", name: "Pause", power: "Halt every transfer of the token at once" },
  { field: "wipe_key", name: "Wipe", power: "Burn a holder's units; they are destroyed, not returned" },
  { field: "supply_key", name: "Supply", power: "Mint or burn supply" },
] as const;

/**
 * The asset's key custody, live from the ledger. Hedera enforces every one of these powers itself,
 * whatever the app or the sale contract does, and the sale holds none of them.
 */
export const KeysPanel = ({ sale }: { sale: Sale }) => {
  const token = sale.asset.token;

  return (
    <section className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <h2 className="card-title text-base m-0">Who controls {token?.symbol ?? "the asset"}</h2>
        <p className="m-0 text-sm opacity-70">
          The ledger shows each role&apos;s public key. It can only name a holder when an account uses that key as its
          own; any other key is held off the ledger, by whoever has it.
        </p>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Key</th>
                <th>Its holder can</th>
                <th>Held by</th>
              </tr>
            </thead>
            <tbody>
              {ROLES.map(role => (
                <tr key={role.field}>
                  <td className="font-semibold">{role.name}</td>
                  <td>{role.power}</td>
                  <td>
                    <Holder publicKey={token?.[role.field]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {token && (
          <p className="m-0 text-xs opacity-60">
            Treasury{" "}
            <ExternalLink href={hashscan.account(token.treasury_account_id)}>{token.treasury_account_id}</ExternalLink>,{" "}
            {token.pause_status === "PAUSED" ? "paused" : "not paused"}, {token.total_supply} units in existence.
          </p>
        )}
      </div>
    </section>
  );
};

const Holder = ({ publicKey }: { publicKey?: MirrorKey }) => {
  const { holder, isLoading } = useKeyHolder(publicKey?.key);
  if (publicKey === null) return <span className="opacity-60">No such key</span>;
  if (isLoading || publicKey === undefined) return <span className="opacity-60">…</span>;
  return (
    <div className="flex flex-col">
      {holder ? (
        <ExternalLink href={hashscan.account(holder.account)}>{holder.account}</ExternalLink>
      ) : (
        <span>No account</span>
      )}
      <span className="font-mono text-xs opacity-60">{shortHex(publicKey.key)}</span>
    </div>
  );
};
