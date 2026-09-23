import { parseAbi } from "viem";

/** The Hedera Token Service system contract. */
export const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";

/**
 * Called directly by the compliance wallet, with no contract in between. A refusal is reported in
 * the returned code while the transaction itself succeeds: a wallet without the KYC key gets 7.
 */
export const HTS_KYC_ABI = parseAbi([
  "function grantTokenKyc(address token, address account) returns (int64 responseCode)",
  "function revokeTokenKyc(address token, address account) returns (int64 responseCode)",
]);

/** HIP-719: every HTS token answers this at its own address, so a plain EVM wallet can associate. */
export const HIP719_ABI = parseAbi(["function associate() returns (uint256 responseCode)"]);

export const SUCCESS = 22;
export const INVALID_SIGNATURE = 7;
export const TOKEN_NOT_ASSOCIATED_TO_ACCOUNT = 184;
export const TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT = 194;

/** A token's long-zero EVM address encodes its entity number: `0x…a2c65e` is `0.0.10667614`. */
export const tokenIdFromAddress = (address: string) => `0.0.${BigInt(address)}`;
