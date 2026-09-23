// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ISaucerSwapV1Router } from "../interfaces/ISaucerSwapV1Router.sol";

/// @title MockSaucerSwapV1Router
/// @notice A stand-in for SaucerSwap's V1 router, for local tests only.
/// @dev The real router lives at a Hedera long-zero address (0.0.19264 is `0x...4b40`). The
///      hedera-forking plugin treats long-zero addresses as HTS tokens and answers calls to them
///      itself, so a forked test that reads the real router gets back data of the wrong shape and
///      the call reverts with "function returned an unexpected amount of data". Deploying this at
///      an ordinary address sidesteps that, and keeps the tests independent of testnet reserves.
///
///      The revert strings are `Error(string)` rather than custom errors on purpose: the real
///      router is a UniswapV2 fork and reverts exactly this way, and tests assert on those
///      strings. SanadSale itself uses custom errors, so a refusal carries its HTS response code.
contract MockSaucerSwapV1Router is ISaucerSwapV1Router {
    address private immutable _factory;
    address private immutable _whbarContract;
    address private immutable _whbarToken;

    /// @notice Tinybars the next exact-output swap will consume. Set it to steer the test.
    uint256 public amountIn;

    /// @param whbarToken_ The address to report as the WHBAR HTS token.
    /// @param whbarContract_ The address to report as the WHBAR wrapper contract.
    /// @param factory_ The address to report as the pair factory.
    constructor(address whbarToken_, address whbarContract_, address factory_) {
        _whbarToken = whbarToken_;
        _whbarContract = whbarContract_;
        _factory = factory_;
    }

    /// @notice Sets the input amount the next swap or quote will report.
    /// @param amountIn_ Tinybars.
    function setAmountIn(uint256 amountIn_) external {
        amountIn = amountIn_;
    }

    /// @inheritdoc ISaucerSwapV1Router
    function factory() external view returns (address) {
        return _factory;
    }

    /// @inheritdoc ISaucerSwapV1Router
    function WHBAR() external view returns (address) {
        return _whbarContract;
    }

    /// @inheritdoc ISaucerSwapV1Router
    function whbar() external view returns (address) {
        return _whbarToken;
    }

    /// @inheritdoc ISaucerSwapV1Router
    function getAmountsIn(
        uint256 amountOut,
        address[] calldata path
    ) external view returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountOut;
    }

    /// @inheritdoc ISaucerSwapV1Router
    /// @dev Refunds the unused HBAR to `msg.sender`, the calling contract, exactly as the real
    ///      router does. It does not move any settlement token: what these tests exercise is
    ///      Sanad's handling of the swap result, not the pool.
    function swapETHForExactTokens(
        uint256 amountOut,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "UniswapV2Router: EXPIRED");
        require(msg.value >= amountIn, "UniswapV2Router: EXCESSIVE_INPUT_AMOUNT");
        require(to != address(0), "UniswapV2Router: INVALID_TO");

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountOut;

        uint256 refund = msg.value - amountIn;
        if (refund > 0) {
            (bool ok, ) = payable(msg.sender).call{ value: refund }("");
            require(ok, "MockRouter: refund failed");
        }
    }
}
