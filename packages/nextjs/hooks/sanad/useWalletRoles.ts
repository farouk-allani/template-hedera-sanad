import { useAccount } from "wagmi";
import { useMirror } from "~~/hooks/sanad/useMirror";
import type { Sale } from "~~/hooks/sanad/useSale";
import { MirrorAccount, accountRoute } from "~~/utils/sanad/mirror";

/**
 * What the connected wallet can sign for this sale, worked out before any transaction is offered.
 * The KYC check cannot be left to the network: a grant from a wallet without the KYC key is not
 * reverted, its transaction succeeds, and simulation reports success too.
 */
export function useWalletRoles(sale: Sale) {
  const { address } = useAccount();
  const account = useMirror<MirrorAccount>(address && accountRoute(address));
  const kycKey = sale.asset.token?.kyc_key?.key;

  return {
    address,
    /** The wallet's Hedera account; null when the address has no account on the network yet. */
    account: account.data,
    isOwner: address !== undefined && address.toLowerCase() === sale.owner.toLowerCase(),
    holdsKycKey: kycKey !== undefined && account.data?.key?.key === kycKey,
  };
}

/** The account whose key is exactly this public key. A key generated on its own has none. */
export function useKeyHolder(publicKey: string | undefined) {
  const holders = useMirror<{ accounts: { account: string; evm_address: string }[] }>(
    publicKey && `/accounts?account.publickey=${publicKey}&balance=false&limit=1`,
  );
  return { holder: holders.data?.accounts[0], isLoading: holders.isPending && publicKey !== undefined };
}
