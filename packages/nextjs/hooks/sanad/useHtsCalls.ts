import type { Address, Hex } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { HIP719_ABI, HTS_ADDRESS, HTS_KYC_ABI } from "~~/utils/sanad/hts";
import { waitForContractResult } from "~~/utils/sanad/mirror";

export type HtsCallOutcome = {
  hash: Hex;
  /** The transaction's own result on the mirror node, e.g. SUCCESS or INSUFFICIENT_GAS. */
  result: string;
  /** The HTS response code the call returned; 22 is success. Absent if the call never returned. */
  code?: number;
};

/**
 * Sends the calls whose outcome the Hedera Token Service reports as a returned response code
 * rather than a revert: a token's own `associate()`, and a KYC change sent straight to `0x167`.
 * A successful receipt only says the transaction ran, so the code is read back from the mirror
 * node. This is also why these calls do not go through the scaffold's `useTransactor`, which
 * announces success for any receipt that did not revert.
 */
export function useHtsCalls() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const outcomeOf = async (hash: Hex): Promise<HtsCallOutcome> => {
    await publicClient?.waitForTransactionReceipt({ hash });
    const { result, call_result } = await waitForContractResult(hash);
    return { hash, result, code: call_result ? Number(BigInt(call_result)) : undefined };
  };

  return {
    associate: async (asset: Address) =>
      outcomeOf(await writeContractAsync({ address: asset, abi: HIP719_ABI, functionName: "associate" })),

    grantKyc: async (asset: Address, account: Address) =>
      outcomeOf(
        await writeContractAsync({
          address: HTS_ADDRESS,
          abi: HTS_KYC_ABI,
          functionName: "grantTokenKyc",
          args: [asset, account],
        }),
      ),

    revokeKyc: async (asset: Address, account: Address) =>
      outcomeOf(
        await writeContractAsync({
          address: HTS_ADDRESS,
          abi: HTS_KYC_ABI,
          functionName: "revokeTokenKyc",
          args: [asset, account],
        }),
      ),
  };
}
