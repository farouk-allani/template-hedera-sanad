import { type Address, getAddress } from "viem";
import { useMirror } from "~~/hooks/sanad/useMirror";
import { useDeployedContractInfo, useScaffoldReadContract } from "~~/hooks/scaffold-hbar";
import { tokenIdFromAddress } from "~~/utils/sanad/hts";
import { MirrorToken, TokenRelationship, relationshipRoute } from "~~/utils/sanad/mirror";
import { ContractAbi } from "~~/utils/scaffold-hbar/contract";

export type SaleToken = { address: Address; id: string; token?: MirrorToken };

export type Sale = {
  address: Address;
  abi: ContractAbi<"SanadSale">;
  /** The sale's Hedera entity ID. The mirror node lists token holders by ID, not by EVM address. */
  contractId?: string;
  owner: Address;
  issuerTreasury: Address;
  /** Settlement-token base units charged per asset unit. */
  pricePerUnit: bigint;
  asset: SaleToken;
  settlement: SaleToken;
  /** Asset units the sale still holds. */
  inventory?: number;
};

type SaleState = { status: "loading" } | { status: "missing" } | { status: "ready"; sale: Sale };

/**
 * The deployed sale. Its terms are immutable in the contract, so they are read once; the token's
 * state (pause, keys) and the inventory change, so they are refreshed from the mirror node.
 */
export function useSale(): SaleState {
  const { data: contract, isLoading } = useDeployedContractInfo({ contractName: "SanadSale" });
  const { data: asset } = useScaffoldReadContract({ contractName: "SanadSale", functionName: "asset", watch: false });
  const { data: settlement } = useScaffoldReadContract({
    contractName: "SanadSale",
    functionName: "settlementToken",
    watch: false,
  });
  const { data: owner } = useScaffoldReadContract({ contractName: "SanadSale", functionName: "owner", watch: false });
  const { data: issuerTreasury } = useScaffoldReadContract({
    contractName: "SanadSale",
    functionName: "issuerTreasury",
    watch: false,
  });
  const { data: pricePerUnit } = useScaffoldReadContract({
    contractName: "SanadSale",
    functionName: "pricePerUnit",
    watch: false,
  });

  const assetId = asset && tokenIdFromAddress(asset);
  const settlementId = settlement && tokenIdFromAddress(settlement);
  const assetToken = useMirror<MirrorToken>(assetId && `/tokens/${assetId}`, 15_000);
  const settlementToken = useMirror<MirrorToken>(settlementId && `/tokens/${settlementId}`);
  const entity = useMirror<{ contract_id: string }>(contract && `/contracts/${contract.address}`);
  const holding = useMirror<{ tokens: TokenRelationship[] }>(
    contract && assetId && relationshipRoute(contract.address, assetId),
    15_000,
  );

  if (isLoading) return { status: "loading" };
  if (!contract) return { status: "missing" };
  if (!asset || !settlement || !owner || !issuerTreasury || pricePerUnit === undefined) return { status: "loading" };

  // The scaffold registers contract addresses as plain strings (types/abitype/abi.d.ts), and whether
  // that registration applies depends on how the package manager lays out node_modules: the reads
  // are typed `string` under npm and `0x${string}` under Yarn. getAddress types them the same way
  // under both, and checksums them.
  return {
    status: "ready",
    sale: {
      address: contract.address,
      abi: contract.abi,
      contractId: entity.data?.contract_id,
      owner: getAddress(owner),
      issuerTreasury: getAddress(issuerTreasury),
      pricePerUnit,
      asset: { address: getAddress(asset), id: tokenIdFromAddress(asset), token: assetToken.data ?? undefined },
      settlement: {
        address: getAddress(settlement),
        id: tokenIdFromAddress(settlement),
        token: settlementToken.data ?? undefined,
      },
      inventory: holding.data?.tokens[0]?.balance,
    },
  };
}
