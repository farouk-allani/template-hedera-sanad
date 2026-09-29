// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// The part of the Hedera Token Service system contract at 0x167 that SanadSale calls. The
/// signatures match the official IHederaTokenService, so the selectors are the network's own.
interface IHederaTokenService {
    /// Associates an account with a token. An account must be associated with a token before it
    /// can hold any balance of it, which is why a contract holding sale inventory associates itself.
    /// @param account The account to associate.
    /// @param token The token to associate it with.
    /// @return responseCode SUCCESS is 22.
    function associateToken(address account, address token) external returns (int64 responseCode);

    /// Transfers a fungible token between two accounts.
    /// The network applies the token's KYC, freeze and pause rules at this point and reports the
    /// outcome in the response code. It does **not** revert on refusal, so an unchecked call looks
    /// like success: 176 ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN, 165 ACCOUNT_FROZEN_FOR_TOKEN,
    /// 184 TOKEN_NOT_ASSOCIATED_TO_ACCOUNT, 265 TOKEN_IS_PAUSED.
    /// @param token The token to move.
    /// @param sender The account debited.
    /// @param recipient The account credited.
    /// @param amount The amount, in the token's smallest unit.
    /// @return responseCode SUCCESS is 22.
    function transferToken(
        address token,
        address sender,
        address recipient,
        int64 amount
    ) external returns (int64 responseCode);
}
