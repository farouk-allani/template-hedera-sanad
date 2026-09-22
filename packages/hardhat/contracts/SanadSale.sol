// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ISaucerSwapV1Router } from "./interfaces/ISaucerSwapV1Router.sol";
import { IHederaTokenService } from "./interfaces/IHederaTokenService.sol";

/// @title SanadSale
/// @notice Sells units of a permissioned HTS asset for HBAR, in one transaction:
///         1. SaucerSwap V1 converts the buyer's HBAR into exactly the settlement amount and pays
///            the issuer's treasury directly.
///         2. This contract delivers the asset from its own inventory.
///         3. The router's refund of unused HBAR is forwarded to the buyer.
///         If step 2 is refused, step 1 is undone with it. There is no state in which the buyer
///         has paid and not been served.
/// @dev Inside a Hedera contract, HBAR amounts (`msg.value`, balances) are tinybars, 8 decimals.
///      Clients send weibars, 18 decimals, and the JSON-RPC relay converts between them.
///
///      This contract deliberately does **not** check KYC, freeze or pause status. Those rules
///      belong to the token and the network applies them during step 2. Checking here as well
///      would fail earlier but is not the guarantee, and it invites the belief that the network's
///      check is redundant. A frontend may pre-check to show a friendlier message.
contract SanadSale {
    /// The Hedera Token Service system contract.
    address public constant HTS = 0x0000000000000000000000000000000000000167;

    /// HTS response code for success.
    int64 public constant SUCCESS = 22;

    /// The SaucerSwap V1 router used for the HBAR to settlement-token leg.
    ISaucerSwapV1Router public immutable router;

    /// The WHBAR **token**, read from the router at construction. Swap paths start here.
    address public immutable whbarToken;

    /// The permissioned asset being sold.
    address public immutable asset;

    /// The token the issuer is paid in.
    address public immutable settlementToken;

    /// Where settlement lands. For an ECDSA account this must be its `evm_address`: HTS refuses
    /// transfers to the long-zero address of an aliased account with INVALID_ALIAS_KEY (282).
    address public immutable issuerTreasury;

    /// Settlement-token base units charged per one asset unit.
    uint256 public immutable pricePerUnit;

    /// The issuer operations account. Set once, at construction, and never transferable.
    address public immutable owner;

    uint256 private _lock = 1;

    /// @notice A completed purchase.
    /// @param buyer The account that paid and received the asset.
    /// @param units Asset units delivered.
    /// @param settlementPaid Settlement-token base units paid to the issuer.
    /// @param hbarSpent Tinybars the swap consumed.
    /// @param hbarRefunded Tinybars returned to the buyer.
    event Purchased(
        address indexed buyer,
        int64 units,
        uint256 settlementPaid,
        uint256 hbarSpent,
        uint256 hbarRefunded
    );

    /// @notice The contract associated itself with the asset so it can hold inventory.
    event AssetAssociated(address indexed asset);

    /// @notice Unsold inventory left the contract.
    /// @param to The recipient.
    /// @param units Asset units moved.
    event InventoryWithdrawn(address indexed to, int64 units);

    /// @notice HBAR that arrived outside a purchase was recovered.
    /// @param to The recipient.
    /// @param amount Tinybars moved.
    event HbarSwept(address indexed to, uint256 amount);

    /// @notice Caller is not the issuer operations account.
    error NotOwner();
    /// @notice A nested call into a guarded function.
    error Reentrancy();
    /// @notice A required address was zero.
    error ZeroAddress();
    /// @notice Units must be positive; the price must not be zero.
    error InvalidAmount();
    /// @notice The quote was no longer valid when the transaction reached consensus.
    error QuoteExpired(uint256 deadline, uint256 blockTimestamp);
    /// @notice The contract could not associate itself with the asset.
    error AssociationFailed(int64 responseCode);
    /// @notice The network refused to deliver the asset, so the whole purchase is reverted.
    ///         176 KYC not granted, 165 account frozen, 184 not associated, 265 token paused.
    error DeliveryFailed(int64 responseCode);
    /// @notice The network refused to move inventory out.
    error WithdrawalFailed(int64 responseCode);
    /// @notice Forwarding HBAR to the buyer failed, so the purchase is reverted.
    error RefundFailed();
    /// @notice Sending HBAR to the recipient failed.
    error SweepFailed();
    /// @notice There is no HBAR to recover.
    error NothingToSweep();
    /// @notice Only the router's refund may reach `receive()`.
    error UnexpectedHbarSender(address sender);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    /// @param router_ SaucerSwap V1 router.
    /// @param asset_ The permissioned HTS asset to sell.
    /// @param settlementToken_ The token the issuer is paid in.
    /// @param issuerTreasury_ Settlement recipient; the `evm_address` for an aliased account.
    /// @param pricePerUnit_ Settlement base units per asset unit.
    constructor(
        address router_,
        address asset_,
        address settlementToken_,
        address issuerTreasury_,
        uint256 pricePerUnit_
    ) {
        if (
            router_ == address(0) ||
            asset_ == address(0) ||
            settlementToken_ == address(0) ||
            issuerTreasury_ == address(0)
        ) {
            revert ZeroAddress();
        }
        if (pricePerUnit_ == 0) revert InvalidAmount();

        router = ISaucerSwapV1Router(router_);
        whbarToken = ISaucerSwapV1Router(router_).whbar();
        asset = asset_;
        settlementToken = settlementToken_;
        issuerTreasury = issuerTreasury_;
        pricePerUnit = pricePerUnit_;
        owner = msg.sender;
    }

    /// @notice Associates this contract with the asset so it can hold sale inventory.
    /// @dev The issuer must also grant this contract KYC before sending it inventory, otherwise
    ///      the inventory transfer itself is refused with 176.
    function associateAsset() external onlyOwner {
        int64 responseCode = IHederaTokenService(HTS).associateToken(address(this), asset);
        if (responseCode != SUCCESS) revert AssociationFailed(responseCode);
        emit AssetAssociated(asset);
    }

    /// @notice The HBAR the pool currently requires for `units`, and the settlement it produces.
    /// @dev A quote is only good for the reserves it was read at. `buy` re-prices at execution and
    ///      is bounded by `msg.value`, so a stale quote costs the buyer nothing beyond fees.
    /// @param units Asset units to price.
    /// @return hbarRequired Tinybars needed at current reserves.
    /// @return settlementAmount Settlement base units the issuer would receive.
    function quote(int64 units) external view returns (uint256 hbarRequired, uint256 settlementAmount) {
        settlementAmount = _settlementFor(units);
        hbarRequired = router.getAmountsIn(settlementAmount, _path())[0];
    }

    /// @notice Buys `units` of the asset, paying in HBAR.
    /// @dev `msg.value` is the buyer's maximum spend, not the price: the router takes what the
    ///      trade costs and the rest comes back.
    /// @param units Asset units to buy.
    /// @param deadline Unix timestamp after which the quote is no longer honoured.
    /// @return hbarSpent Tinybars the swap actually consumed.
    function buy(int64 units, uint256 deadline) external payable nonReentrant returns (uint256 hbarSpent) {
        if (block.timestamp > deadline) revert QuoteExpired(deadline, block.timestamp);
        uint256 settlementAmount = _settlementFor(units);

        // 1. Exact-output swap, paid straight to the issuer. The router reverts with
        //    EXCESSIVE_INPUT_AMOUNT if msg.value cannot cover the trade.
        uint256[] memory amounts = router.swapETHForExactTokens{ value: msg.value }(
            settlementAmount,
            _path(),
            issuerTreasury,
            deadline
        );
        hbarSpent = amounts[0];

        // 2. Delivery. The network applies the token's KYC, freeze and pause rules here and
        //    reports refusal in the response code rather than reverting, so this check is what
        //    turns a refusal into a full rollback of step 1.
        int64 responseCode = IHederaTokenService(HTS).transferToken(asset, address(this), msg.sender, units);
        if (responseCode != SUCCESS) revert DeliveryFailed(responseCode);

        // 3. The router refunded the unused HBAR to this contract, not to the buyer.
        uint256 refund = msg.value - hbarSpent;
        if (refund > 0) {
            (bool ok, ) = payable(msg.sender).call{ value: refund }("");
            if (!ok) revert RefundFailed();
        }

        emit Purchased(msg.sender, units, settlementAmount, hbarSpent, refund);
    }

    /// @notice Moves unsold inventory out of the contract.
    /// @dev Without this the asset is stranded in an abandoned sale. The recipient must be
    ///      associated with the asset and hold KYC, or the network refuses with 184 or 176.
    /// @param to The recipient.
    /// @param units Asset units to move.
    function withdrawInventory(address to, int64 units) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (units <= 0) revert InvalidAmount();

        int64 responseCode = IHederaTokenService(HTS).transferToken(asset, address(this), to, units);
        if (responseCode != SUCCESS) revert WithdrawalFailed(responseCode);
        emit InventoryWithdrawn(to, units);
    }

    /// @notice Recovers HBAR held by this contract.
    /// @dev A completed purchase leaves no HBAR behind, but Hedera does not run `receive()` on a
    ///      native CryptoTransfer, so HBAR can still arrive without passing the guard below.
    ///      Without this it would be stranded.
    /// @param to The recipient.
    function sweepHbar(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToSweep();

        (bool ok, ) = payable(to).call{ value: amount }("");
        if (!ok) revert SweepFailed();
        emit HbarSwept(to, amount);
    }

    /// @dev Only the router's refund is expected here. This guard is not airtight, and is not
    ///      relied upon: Hedera credits HBAR by CryptoTransfer without invoking `receive()`, so
    ///      `sweepHbar` exists for whatever arrives that way.
    receive() external payable {
        if (msg.sender != address(router)) revert UnexpectedHbarSender(msg.sender);
    }

    /// @dev Settlement owed for `units`, rejecting the non-positive values an int64 allows.
    function _settlementFor(int64 units) private view returns (uint256) {
        if (units <= 0) revert InvalidAmount();
        return uint256(uint64(units)) * pricePerUnit;
    }

    /// @dev The swap path. Starts at the router's WHBAR *token*, never the wrapper contract.
    function _path() private view returns (address[] memory path) {
        path = new address[](2);
        path[0] = whbarToken;
        path[1] = settlementToken;
    }
}
