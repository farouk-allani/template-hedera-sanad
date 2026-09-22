// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// The part of SaucerSwap's V1 router (RouterV3) that Sanad uses.
/// Verified against saucerswaplabs/saucerswap-periphery @ 606a003, UniswapV2Router02.sol.
///
/// The router exposes two WHBAR addresses and they are not interchangeable: `WHBAR()` is the
/// wrapper *contract*, `whbar()` is the HTS *token*. A swap path must start with `whbar()`, or
/// the router reverts with INVALID_PATH.
interface ISaucerSwapV1Router {
    /// The factory that created the pairs this router trades against.
    function factory() external view returns (address);

    /// The WHBAR wrapper contract. This is **not** the address to put in a swap path.
    function WHBAR() external view returns (address);

    /// The WHBAR HTS token. Swap paths start here.
    function whbar() external view returns (address);

    /// Spends at most `msg.value` HBAR to deliver exactly `amountOut` of the last token in `path`.
    /// Reverts with EXCESSIVE_INPUT_AMOUNT when `msg.value` cannot cover the trade.
    /// @dev Unused HBAR is refunded to `msg.sender`, which is the calling contract rather than the
    ///      end user. A caller that forgets to pass the refund on simply keeps the buyer's change.
    /// @param amountOut The exact amount of the output token to deliver.
    /// @param path Token addresses, starting at `whbar()`.
    /// @param to The recipient of the output token.
    /// @param deadline Unix timestamp after which the router rejects the trade.
    /// @return amounts Input and output amounts; `amounts[0]` is the HBAR actually spent, in tinybars.
    function swapETHForExactTokens(
        uint256 amountOut,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);

    /// The input amounts required to receive `amountOut` along `path`, at current reserves.
    /// @return amounts `amounts[0]` is the HBAR required, in tinybars.
    function getAmountsIn(
        uint256 amountOut,
        address[] calldata path
    ) external view returns (uint256[] memory amounts);
}
