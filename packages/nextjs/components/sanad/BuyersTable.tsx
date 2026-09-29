import type { ReactNode } from "react";
import { ExternalLink } from "~~/components/sanad/ExternalLink";
import type { Buyer } from "~~/hooks/sanad/useBuyers";
import { hashscan, shortHex } from "~~/utils/sanad/format";
import type { TokenRelationship } from "~~/utils/sanad/mirror";

/**
 * An account's standing with the asset. The mirror node reports "never approved" and "approved,
 * then revoked" alike as REVOKED, so both read "Not approved".
 */
const ApprovalBadge = ({ relationship }: { relationship?: TokenRelationship }) => {
  if (!relationship) return <span className="badge badge-ghost">Not associated</span>;
  if (relationship.freeze_status === "FROZEN") return <span className="badge badge-error">Frozen</span>;
  if (relationship.kyc_status === "GRANTED") return <span className="badge badge-success">Approved</span>;
  return <span className="badge badge-warning">Not approved</span>;
};

export const BuyersTable = ({
  buyers,
  assetSymbol,
  action,
}: {
  buyers: Buyer[];
  assetSymbol?: string;
  action?: (buyer: Buyer) => ReactNode;
}) => (
  <div className="overflow-x-auto">
    <table className="table">
      <thead>
        <tr>
          <th>Account</th>
          <th>Standing</th>
          <th className="text-right">Holds {assetSymbol}</th>
          {action && <th className="text-right">Action</th>}
        </tr>
      </thead>
      <tbody>
        {buyers.map(buyer => (
          <tr key={buyer.id}>
            <td>
              <ExternalLink href={hashscan.account(buyer.id)}>{buyer.id}</ExternalLink>
              <div className="text-xs font-mono opacity-60">{shortHex(buyer.evmAddress)}</div>
            </td>
            <td>
              <ApprovalBadge relationship={buyer.relationship} />
            </td>
            <td className="text-right tabular-nums">{buyer.relationship?.balance ?? "—"}</td>
            {action && <td className="text-right">{action(buyer)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
