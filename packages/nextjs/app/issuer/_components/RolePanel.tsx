import { CheckCircleIcon, MinusCircleIcon } from "@heroicons/react/24/outline";
import type { Sale } from "~~/hooks/sanad/useSale";
import { useKeyHolder, type useWalletRoles } from "~~/hooks/sanad/useWalletRoles";
import { shortHex } from "~~/utils/sanad/format";

type Roles = ReturnType<typeof useWalletRoles>;

/**
 * Two different authorities act here, usually two different wallets: the asset's KYC key approves
 * buyers, and the sale's owner withdraws inventory. The panel says which of them the connected
 * wallet is, and who to connect otherwise, before any action is offered.
 */
export const RolePanel = ({ sale, roles }: { sale: Sale; roles: Roles }) => {
  const kycKey = sale.asset.token?.kyc_key;
  const { holder } = useKeyHolder(kycKey?.key);

  if (!roles.address) {
    return (
      <section className="card bg-base-100 border border-base-300">
        <div className="card-body">
          <p className="m-0">
            Connect a wallet to act. The console works out what the wallet can sign before it offers anything, because
            the network would accept an approval from the wrong wallet as a successful transaction and change nothing.
          </p>
        </div>
      </section>
    );
  }

  const approvals = !kycKey
    ? "This asset has no KYC key, so every associated account can buy and there is nothing to approve."
    : roles.holdsKycKey
      ? "This wallet's account key is the asset's KYC key. It can approve and revoke buyers."
      : holder
        ? `Approving buyers takes the asset's KYC key, which is the key of account ${holder.account}. Connect that wallet to approve or revoke.`
        : "No account uses the asset's KYC key as its own, so approvals cannot be signed from a browser wallet.";

  const inventory = roles.isOwner
    ? "This wallet deployed the sale. It can withdraw unsold inventory."
    : `Withdrawing inventory takes the sale's owner, ${shortHex(sale.owner)}.`;

  return (
    <section className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <h2 className="card-title text-base m-0">This wallet</h2>
        <p className="m-0 text-sm opacity-70">
          {roles.account === undefined
            ? "Looking up the account"
            : roles.account
              ? `Account ${roles.account.account}`
              : "No Hedera account yet"}
          , {shortHex(roles.address)}
        </p>
        <ul className="m-0 p-0 list-none flex flex-col gap-2">
          <Role granted={roles.holdsKycKey} name="Compliance" text={approvals} />
          <Role granted={roles.isOwner} name="Sale owner" text={inventory} />
        </ul>
      </div>
    </section>
  );
};

const Role = ({ granted, name, text }: { granted: boolean; name: string; text: string }) => (
  <li className="flex items-start gap-2">
    {granted ? (
      <CheckCircleIcon className="h-5 w-5 shrink-0 text-success" aria-label="Held" />
    ) : (
      <MinusCircleIcon className="h-5 w-5 shrink-0 opacity-50" aria-label="Not held" />
    )}
    <span>
      <span className="font-semibold">{name}.</span> {text}
    </span>
  </li>
);
