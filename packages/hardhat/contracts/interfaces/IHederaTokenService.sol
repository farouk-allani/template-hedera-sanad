// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// Minimal interface for the HTS precompile at 0x167 (create fungible token + mint).
/// Struct layout matches the official IHederaTokenService for ABI compatibility.
interface IHederaTokenService {
    struct Expiry {
        int64 second;
        address autoRenewAccount;
        int64 autoRenewPeriod;
    }

    struct KeyValue {
        bool inheritAccountKey;
        address contractId;
        bytes ed25519;
        bytes ECDSA_secp256k1;
        address delegatableContractId;
    }

    struct TokenKey {
        uint256 keyType;
        KeyValue key;
    }

    struct HederaToken {
        string name;
        string symbol;
        address treasury;
        string memo;
        bool tokenSupplyType;
        int64 maxSupply;
        bool freezeDefault;
        TokenKey[] tokenKeys;
        Expiry expiry;
    }

    /// Creates a Fungible Token with the specified properties.
    /// @return responseCode SUCCESS is 22.
    /// @return tokenAddress The created token's address.
    function createFungibleToken(
        HederaToken memory token,
        int64 initialTotalSupply,
        int32 decimals
    ) external payable returns (int64 responseCode, address tokenAddress);

    /// Mints an amount of the token to the treasury account.
    /// @param metadata For NFTs only; use empty array for fungible.
    /// @return responseCode SUCCESS is 22.
    function mintToken(
        address token,
        int64 amount,
        bytes[] memory metadata
    ) external returns (int64 responseCode, int64 newTotalSupply, int64[] memory serialNumbers);

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
