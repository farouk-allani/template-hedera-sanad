import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * Local suite. No HBAR is spent and nothing reaches consensus.
 *
 * The router is mocked rather than read from the fork. The real SaucerSwap V1 router sits at a
 * Hedera long-zero address (0.0.19264 is `0x...4b40`), and the hedera-forking plugin answers calls
 * to long-zero addresses itself, as if they were HTS tokens. Reading the real router under
 * HEDERA_FORKING therefore reverts with "function returned an unexpected amount of data".
 *
 * What is deliberately NOT here: anything depending on KYC, freeze or pause. The forking plugin
 * does not implement them at all — they are commented out of its own IHederaTokenService — so a
 * local test asserting a 176 rollback would be asserting a fiction. That behaviour is proved
 * against real testnet in the testnet suite. See D26.
 */

const WHBAR_TOKEN = "0x0000000000000000000000000000000000003ad2";
const WHBAR_CONTRACT = "0x0000000000000000000000000000000000003ad1";
const FACTORY = "0x00000000000000000000000000000000000026e7";

// The constructor only rejects the zero address, so tests that never reach HTS can use any
// non-zero address for the tokens and the treasury.
const ASSET = "0x0000000000000000000000000000000000000a11";
const SETTLEMENT = "0x0000000000000000000000000000000000000b22";
const TREASURY = "0x0000000000000000000000000000000000000c33";
const PRICE_PER_UNIT = 10_000_000n; // 10 settlement tokens at 6 decimals

describe("SanadSale", function () {
  async function deployRouter() {
    const routerFactory = await ethers.getContractFactory("MockSaucerSwapV1Router");
    const router = await routerFactory.deploy(WHBAR_TOKEN, WHBAR_CONTRACT, FACTORY);
    await router.waitForDeployment();
    return router;
  }

  async function deploy() {
    const [issuer, stranger] = await ethers.getSigners();
    const router = await deployRouter();
    const factory = await ethers.getContractFactory("SanadSale");
    const sale = await factory.deploy(await router.getAddress(), ASSET, SETTLEMENT, TREASURY, PRICE_PER_UNIT);
    await sale.waitForDeployment();
    return { sale, router, issuer, stranger };
  }

  const inFuture = () => BigInt(Math.floor(Date.now() / 1000) + 300);
  const inPast = () => BigInt(Math.floor(Date.now() / 1000) - 600);

  describe("construction", function () {
    it("records the sale terms so they cannot be changed later", async function () {
      const { sale, issuer } = await deploy();
      expect(await sale.asset()).to.equal(ethers.getAddress(ASSET));
      expect(await sale.settlementToken()).to.equal(ethers.getAddress(SETTLEMENT));
      expect(await sale.issuerTreasury()).to.equal(ethers.getAddress(TREASURY));
      expect(await sale.pricePerUnit()).to.equal(PRICE_PER_UNIT);
      expect(await sale.owner()).to.equal(issuer.address);
    });

    it("takes the WHBAR token from the router, not the wrapper contract", async function () {
      const { sale, router } = await deploy();
      // A path built from WHBAR() instead of whbar() is rejected by the real router with
      // INVALID_PATH, so which of the two the contract stores is the whole question.
      expect(await sale.whbarToken()).to.equal(await router.whbar());
      expect(await sale.whbarToken()).to.not.equal(await router.WHBAR());
    });

    it("refuses a zero address for any of the four it cannot do without", async function () {
      const factory = await ethers.getContractFactory("SanadSale");
      const router = await (await deployRouter()).getAddress();
      const zero = ethers.ZeroAddress;
      for (const [r, a, s, t] of [
        [zero, ASSET, SETTLEMENT, TREASURY],
        [router, zero, SETTLEMENT, TREASURY],
        [router, ASSET, zero, TREASURY],
        [router, ASSET, SETTLEMENT, zero],
      ]) {
        await expect(factory.deploy(r, a, s, t, PRICE_PER_UNIT)).to.be.reverted;
      }
    });

    it("refuses a zero price, which would give the asset away", async function () {
      const factory = await ethers.getContractFactory("SanadSale");
      const router = await (await deployRouter()).getAddress();
      await expect(factory.deploy(router, ASSET, SETTLEMENT, TREASURY, 0n)).to.be.revertedWithCustomError(
        factory,
        "InvalidAmount",
      );
    });
  });

  describe("quote", function () {
    it("charges price per unit times units, and reports what the pool would take", async function () {
      const { sale, router } = await deploy();
      const hbarTheRouterWants = 2_08000000n; // tinybars
      await router.setAmountIn(hbarTheRouterWants);

      const [hbarRequired, settlementAmount] = await sale.quote(3);
      expect(settlementAmount).to.equal(PRICE_PER_UNIT * 3n);
      expect(hbarRequired).to.equal(hbarTheRouterWants);
    });

    it("refuses to price nothing", async function () {
      const { sale } = await deploy();
      for (const units of [0, -1]) {
        await expect(sale.quote(units)).to.be.revertedWithCustomError(sale, "InvalidAmount");
      }
    });
  });

  describe("buy", function () {
    it("rejects an expired quote before it touches the pool", async function () {
      const { sale } = await deploy();
      const deadline = inPast();
      await expect(sale.buy(2, deadline, { value: ethers.parseEther("1") }))
        .to.be.revertedWithCustomError(sale, "QuoteExpired")
        .withArgs(deadline, (t: bigint) => t > deadline);
    });

    it("rejects a purchase of nothing", async function () {
      const { sale } = await deploy();
      for (const units of [0, -1]) {
        await expect(sale.buy(units, inFuture(), { value: ethers.parseEther("1") })).to.be.revertedWithCustomError(
          sale,
          "InvalidAmount",
        );
      }
    });

    it("stops at the pool when the budget cannot cover the trade, before any delivery", async function () {
      const { sale, router } = await deploy();
      await router.setAmountIn(1_000_000n);
      // The router's own guard fires first, so the buyer never reaches HTS delivery.
      await expect(sale.buy(1, inFuture(), { value: 999_999n })).to.be.revertedWith(
        "UniswapV2Router: EXCESSIVE_INPUT_AMOUNT",
      );
    });

    it("reverts the whole purchase when the network refuses delivery", async function () {
      const { sale, router } = await deploy();
      await router.setAmountIn(1_000n);
      // ASSET is not a real HTS token, so the delivery call cannot succeed. What this proves is
      // that a failed delivery aborts the purchase rather than being ignored: the swap already
      // ran by this point. D7.
      await expect(sale.buy(1, inFuture(), { value: 10_000n })).to.be.reverted;
      expect(await ethers.provider.getBalance(await sale.getAddress())).to.equal(0n);
    });
  });

  describe("privileged functions", function () {
    it("lets nobody but the issuer associate, withdraw or sweep", async function () {
      const { sale, stranger } = await deploy();
      const asStranger = sale.connect(stranger);
      await expect(asStranger.associateAsset()).to.be.revertedWithCustomError(sale, "NotOwner");
      await expect(asStranger.withdrawInventory(stranger.address, 1)).to.be.revertedWithCustomError(sale, "NotOwner");
      await expect(asStranger.sweepHbar(stranger.address)).to.be.revertedWithCustomError(sale, "NotOwner");
    });

    it("refuses to send inventory to the zero address or to move nothing", async function () {
      const { sale, issuer } = await deploy();
      await expect(sale.withdrawInventory(ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(sale, "ZeroAddress");
      await expect(sale.withdrawInventory(issuer.address, 0)).to.be.revertedWithCustomError(sale, "InvalidAmount");
    });

    it("refuses to sweep when the contract holds no HBAR", async function () {
      const { sale, issuer } = await deploy();
      expect(await ethers.provider.getBalance(await sale.getAddress())).to.equal(0n);
      await expect(sale.sweepHbar(issuer.address)).to.be.revertedWithCustomError(sale, "NothingToSweep");
    });
  });

  describe("receive", function () {
    it("refuses HBAR from anyone but the router", async function () {
      const { sale, stranger } = await deploy();
      await expect(stranger.sendTransaction({ to: await sale.getAddress(), value: 1n })).to.be.revertedWithCustomError(
        sale,
        "UnexpectedHbarSender",
      );
      expect(await ethers.provider.getBalance(await sale.getAddress())).to.equal(0n);
    });
  });
});
