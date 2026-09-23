/**
 * Acceptance tests against real Hedera testnet. They live outside `test/` on purpose: everything
 * in `test/` runs under `yarn hardhat:test`, which must never need a funded key. D20.
 *
 *   yarn sanad:setup   # once, builds tokens, pool, contract and inventory
 *   yarn sanad:test
 *
 * These are the tests that matter. KYC, freeze and pause do not exist in the local fork, so this
 * is the only place the behaviour Sanad exists for can actually be proved. D26.
 *
 * Every rollback test compares pool reserves and balances, not just the error: a revert with the
 * right name would still be a failure if the swap had already paid the issuer.
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  AccountId,
  PrivateKey,
  TokenFreezeTransaction,
  TokenId,
  TokenPauseTransaction,
  TokenRevokeKycTransaction,
  TokenUnfreezeTransaction,
  TokenUnpauseTransaction,
} from "@hashgraph/sdk";
import type { ContractTransactionResponse, Provider, Wallet } from "ethers";
import type { SanadSale } from "../typechain-types";
import {
  DEPLOYMENT_FILE,
  Deployment,
  EVIDENCE_FILE,
  KEYS_FILE,
  StoredKeys,
  WEIBAR_PER_TINYBAR,
  decodeRevert,
  issuer,
  mirrorTxUrl,
  readJson,
  tokenRelationship,
  waitForContractResult,
  waitForPauseStatus,
  waitForRelationship,
  writeJson,
} from "../scripts/sanad/hedera";

const INVALID_SIGNATURE = 7n;
const SUCCESS = 22n;
const ACCOUNT_FROZEN_FOR_TOKEN = 165n;
const ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN = 176n;
const TOKEN_IS_PAUSED = 265n;

/** The HTS system contract. A compliance wallet calls it directly, with no contract in between. */
const HTS = "0x0000000000000000000000000000000000000167";
const HTS_KYC = [
  "function grantTokenKyc(address token, address account) returns (int64 responseCode)",
  "function revokeTokenKyc(address token, address account) returns (int64 responseCode)",
];

/** buy() used ~226k gas in the spike; 1.5M is ample and leaves a revert on-chain as evidence. */
const GAS_LIMIT = 1_500_000n;
const UNITS = 2n;

const ERC20 = ["function balanceOf(address) view returns (uint256)"];
const PAIR = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
];

interface Snapshot {
  whbarReserve: bigint;
  settlementReserve: bigint;
  issuerSettlement: bigint;
  inventory: bigint;
  buyerAsset: bigint;
  buyerHbarWeibar: bigint;
  saleHbarWeibar: bigint;
}

/** Everything a purchase could move. */
async function snapshot(d: Deployment, provider: Provider, buyer: string): Promise<Snapshot> {
  const pair = new ethers.Contract(d.pair, PAIR, provider);
  const settlement = new ethers.Contract(d.settlementToken, ERC20, provider);
  const asset = new ethers.Contract(d.asset, ERC20, provider);
  const [reserves, token0, issuerSettlement, inventory, buyerAsset, buyerHbarWeibar, saleHbarWeibar] =
    await Promise.all([
      pair.getReserves(),
      pair.token0(),
      settlement.balanceOf(d.issuerTreasury),
      asset.balanceOf(d.sanad),
      asset.balanceOf(buyer),
      provider.getBalance(buyer),
      provider.getBalance(d.sanad),
    ]);
  const whbarIsToken0 = String(token0).toLowerCase() === d.whbarToken.toLowerCase();
  return {
    whbarReserve: whbarIsToken0 ? reserves[0] : reserves[1],
    settlementReserve: whbarIsToken0 ? reserves[1] : reserves[0],
    issuerSettlement,
    inventory,
    buyerAsset,
    buyerHbarWeibar,
    saleHbarWeibar,
  };
}

describe("SanadSale on testnet: HBAR in, exact settlement out, permissioned delivery", function () {
  this.timeout(10 * 60 * 1000);

  let d: Deployment;
  let sale: SanadSale;
  let approved: Wallet;
  let unapproved: Wallet;
  let complianceWallet: Wallet;
  let freezeKey: PrivateKey;
  let pauseKey: PrivateKey;
  let kycKey: PrivateKey;
  const evidence: { test: string; result: string; revert?: string; returned?: string; mirror: string }[] = [];

  before(async function () {
    d = readJson<Deployment>(DEPLOYMENT_FILE);
    const keys = readJson<StoredKeys>(KEYS_FILE);
    approved = new ethers.Wallet(keys["buyer.approved"]!, ethers.provider);
    unapproved = new ethers.Wallet(keys["buyer.unapproved"]!, ethers.provider);
    // The account whose key is the asset's KYC key: what the issuer console connects as. D36.
    complianceWallet = new ethers.Wallet(keys.kyc!, ethers.provider);
    freezeKey = PrivateKey.fromStringECDSA(keys.freeze!.replace(/^0x/, ""));
    pauseKey = PrivateKey.fromStringECDSA(keys.pause!.replace(/^0x/, ""));
    kycKey = PrivateKey.fromStringECDSA(keys.kyc!.replace(/^0x/, ""));
    sale = await ethers.getContractAt("SanadSale", d.sanad);
  });

  after(function () {
    if (evidence.length === 0) return;
    writeJson(EVIDENCE_FILE, { deployment: d, runAt: new Date().toISOString(), transactions: evidence });
    console.log(`\n  evidence written to ${EVIDENCE_FILE}`);
  });

  /** Sends a buy with an explicit gas limit, so a revert lands on-chain as evidence. */
  async function buy(from: Wallet, budgetTinybars: bigint, deadline: bigint, label: string) {
    const tx = (await sale.connect(from).getFunction("buy")(UNITS, deadline, {
      value: budgetTinybars * WEIBAR_PER_TINYBAR,
      gasLimit: GAS_LIMIT,
    })) as ContractTransactionResponse;
    const receipt = await tx.wait().catch(() => null); // several tests expect a revert
    const result = await waitForContractResult(tx.hash);
    const revert = result.result === "SUCCESS" ? undefined : decodeRevert(result.error_message, sale.interface);
    evidence.push({ test: label, result: result.result, revert, mirror: mirrorTxUrl(tx.hash) });
    console.log(`      ${result.result}${revert ? ` ${revert}` : ""}\n      ${mirrorTxUrl(tx.hash)}`);
    return { tx, receipt, result, revert, maxFeeWeibar: GAS_LIMIT * (tx.maxFeePerGas ?? tx.gasPrice ?? 0n) };
  }

  async function quote() {
    const [hbarRequired, settlementAmount] = await sale.getFunction("quote")(UNITS);
    return { hbarRequired: hbarRequired as bigint, settlementAmount: settlementAmount as bigint };
  }

  /**
   * Sends a KYC call straight to the HTS system contract, as a browser wallet does, and reads back
   * both the transaction's outcome and the response code the call returned. They can disagree.
   */
  async function kycCall(from: Wallet, fn: "grantTokenKyc" | "revokeTokenKyc", account: string, label: string) {
    const hts = new ethers.Contract(HTS, HTS_KYC, from);
    const tx = (await hts.getFunction(fn)(d.asset, account, { gasLimit: 200_000 })) as ContractTransactionResponse;
    await tx.wait().catch(() => null);
    const result = await waitForContractResult(tx.hash);
    const returned = result.call_result ? BigInt(result.call_result) : undefined;
    evidence.push({ test: label, result: result.result, returned: String(returned), mirror: mirrorTxUrl(tx.hash) });
    console.log(`      ${result.result}, returned ${returned}\n      ${mirrorTxUrl(tx.hash)}`);
    return { result: result.result, returned };
  }

  const inFuture = () => BigInt(Math.floor(Date.now() / 1000) + 300);

  function expectNothingSettled(before: Snapshot, after: Snapshot, maxFeeWeibar: bigint) {
    expect(after.whbarReserve, "pool WHBAR reserve").to.equal(before.whbarReserve);
    expect(after.settlementReserve, "pool sUSD reserve").to.equal(before.settlementReserve);
    expect(after.issuerSettlement, "issuer sUSD").to.equal(before.issuerSettlement);
    expect(after.inventory, "sale inventory").to.equal(before.inventory);
    expect(after.buyerAsset, "buyer asset").to.equal(before.buyerAsset);
    expect(after.saleHbarWeibar, "HBAR stranded in the sale contract").to.equal(0n);
    // The buyer loses the network fee and nothing else. Never the budget.
    expect(before.buyerHbarWeibar - after.buyerHbarWeibar, "buyer HBAR lost").to.be.lte(maxFeeWeibar);
  }

  it("1. approved buyer: exact settlement to the issuer, asset delivered, change returned", async function () {
    const { hbarRequired, settlementAmount } = await quote();
    const budget = hbarRequired * 3n; // generous, so a missing refund would be obvious
    const before = await snapshot(d, ethers.provider, approved.address);

    const { result, receipt, maxFeeWeibar } = await buy(approved, budget, inFuture(), "approved purchase");
    expect(result.result).to.equal("SUCCESS");

    const event = receipt!.logs.map(log => sale.interface.parseLog(log)).find(parsed => parsed?.name === "Purchased")!;
    const hbarSpent = event.args.hbarSpent as bigint;
    expect(event.args.settlementPaid).to.equal(settlementAmount);
    expect(event.args.hbarRefunded, "refund is budget minus spend").to.equal(budget - hbarSpent);

    const after = await snapshot(d, ethers.provider, approved.address);
    expect(after.issuerSettlement - before.issuerSettlement, "issuer received exactly").to.equal(settlementAmount);
    expect(before.settlementReserve - after.settlementReserve, "pool paid out").to.equal(settlementAmount);
    expect(after.whbarReserve - before.whbarReserve, "pool received").to.equal(hbarSpent);
    expect(after.buyerAsset - before.buyerAsset, "buyer received").to.equal(UNITS);
    expect(before.inventory - after.inventory, "inventory used").to.equal(UNITS);
    expect(after.saleHbarWeibar, "HBAR stranded in the sale contract").to.equal(0n);

    const spentWeibar = hbarSpent * WEIBAR_PER_TINYBAR;
    const buyerPaid = before.buyerHbarWeibar - after.buyerHbarWeibar;
    expect(buyerPaid, "buyer paid at least the swap").to.be.gte(spentWeibar);
    expect(buyerPaid, "buyer paid the swap and fees, not the whole budget").to.be.lte(spentWeibar + maxFeeWeibar);
  });

  it("2. associated buyer without KYC: the network refuses delivery and the swap rolls back", async function () {
    const rel = await waitForRelationship(d.buyers.unapproved.id, d.assetTokenId, r => r !== undefined);
    expect(rel!.kyc_status, "precondition: associated, not approved").to.equal("REVOKED");

    const { hbarRequired } = await quote();
    const before = await snapshot(d, ethers.provider, unapproved.address);
    const { result, revert, maxFeeWeibar } = await buy(unapproved, hbarRequired * 2n, inFuture(), "buyer without KYC");

    expect(result.result).to.equal("CONTRACT_REVERT_EXECUTED");
    // Reaching our own error proves HTS *returned* 176 rather than reverting by itself, and that
    // the contract turned that code into a full rollback. D7.
    expect(revert).to.equal(`DeliveryFailed(${ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN})`);
    expectNothingSettled(before, await snapshot(d, ethers.provider, unapproved.address), maxFeeWeibar);
  });

  it("3. frozen buyer: approval is not permanent, and nothing settles", async function () {
    const { client } = await issuer();
    const accountId = AccountId.fromString(d.buyers.approved.id);
    const tokenId = TokenId.fromString(d.assetTokenId);
    const freeze = await new TokenFreezeTransaction()
      .setAccountId(accountId)
      .setTokenId(tokenId)
      .freezeWith(client)
      .sign(freezeKey);
    await (await freeze.execute(client)).getReceipt(client);
    try {
      await waitForRelationship(d.buyers.approved.id, d.assetTokenId, r => r?.freeze_status === "FROZEN");
      const { hbarRequired } = await quote();
      const before = await snapshot(d, ethers.provider, approved.address);
      const { result, revert, maxFeeWeibar } = await buy(approved, hbarRequired * 2n, inFuture(), "frozen buyer");

      expect(result.result).to.equal("CONTRACT_REVERT_EXECUTED");
      expect(revert).to.equal(`DeliveryFailed(${ACCOUNT_FROZEN_FOR_TOKEN})`);
      expectNothingSettled(before, await snapshot(d, ethers.provider, approved.address), maxFeeWeibar);
    } finally {
      const unfreeze = await new TokenUnfreezeTransaction()
        .setAccountId(accountId)
        .setTokenId(tokenId)
        .freezeWith(client)
        .sign(freezeKey);
      await (await unfreeze.execute(client)).getReceipt(client);
      client.close();
    }
  });

  it("4. budget below the required HBAR: the router refuses and nothing settles", async function () {
    const { hbarRequired } = await quote();
    const before = await snapshot(d, ethers.provider, approved.address);
    const { result, revert, maxFeeWeibar } = await buy(approved, hbarRequired - 1n, inFuture(), "budget too low");

    expect(result.result).to.equal("CONTRACT_REVERT_EXECUTED");
    expect(revert).to.contain("EXCESSIVE_INPUT_AMOUNT");
    expectNothingSettled(before, await snapshot(d, ethers.provider, approved.address), maxFeeWeibar);
  });

  it("5. expired quote: rejected before the pool is touched", async function () {
    const { hbarRequired } = await quote();
    const expired = BigInt(Math.floor(Date.now() / 1000) - 600);
    const before = await snapshot(d, ethers.provider, approved.address);
    const { result, revert, maxFeeWeibar } = await buy(approved, hbarRequired * 2n, expired, "expired quote");

    expect(result.result).to.equal("CONTRACT_REVERT_EXECUTED");
    expect(revert).to.match(/^QuoteExpired\(/);
    expectNothingSettled(before, await snapshot(d, ethers.provider, approved.address), maxFeeWeibar);
  });

  it("6. the issuer can take unsold inventory back out", async function () {
    const asset = new ethers.Contract(d.asset, ERC20, ethers.provider);
    const inventoryBefore = (await asset.balanceOf(d.sanad)) as bigint;
    const issuerBefore = (await asset.balanceOf(d.issuerTreasury)) as bigint;
    expect(inventoryBefore, "there is inventory to withdraw").to.be.gt(0n);

    const tx = await sale.getFunction("withdrawInventory")(d.issuerTreasury, 1, { gasLimit: 1_000_000 });
    await tx.wait();
    const result = await waitForContractResult(tx.hash);
    evidence.push({ test: "inventory withdrawal", result: result.result, mirror: mirrorTxUrl(tx.hash) });
    expect(result.result).to.equal("SUCCESS");

    expect((await asset.balanceOf(d.sanad)) as bigint, "inventory fell by one").to.equal(inventoryBefore - 1n);
    expect((await asset.balanceOf(d.issuerTreasury)) as bigint, "issuer received it").to.equal(issuerBefore + 1n);
  });

  it("7. a stranger cannot associate, withdraw inventory or sweep HBAR", async function () {
    const asStranger = sale.connect(unapproved);
    const asset = new ethers.Contract(d.asset, ERC20, ethers.provider);
    const inventoryBefore = (await asset.balanceOf(d.sanad)) as bigint;

    for (const call of [
      () => asStranger.getFunction("associateAsset")({ gasLimit: 400_000 }),
      () => asStranger.getFunction("withdrawInventory")(unapproved.address, 1, { gasLimit: 400_000 }),
      () => asStranger.getFunction("sweepHbar")(unapproved.address, { gasLimit: 400_000 }),
    ]) {
      const tx = (await call()) as ContractTransactionResponse;
      await tx.wait().catch(() => null);
      const result = await waitForContractResult(tx.hash);
      expect(result.result, "a stranger's call must revert").to.equal("CONTRACT_REVERT_EXECUTED");
      expect(decodeRevert(result.error_message, sale.interface)).to.equal("NotOwner()");
    }

    expect((await asset.balanceOf(d.sanad)) as bigint, "inventory untouched").to.equal(inventoryBefore);
  });

  it("8. paused asset: the simulation reports the refusal, the network refuses delivery, nothing settles", async function () {
    const { client } = await issuer();
    const tokenId = TokenId.fromString(d.assetTokenId);
    const pause = await new TokenPauseTransaction().setTokenId(tokenId).freezeWith(client).sign(pauseKey);
    await (await pause.execute(client)).getReceipt(client);
    try {
      await waitForPauseStatus(d.assetTokenId, "PAUSED");
      const { hbarRequired } = await quote();
      const budget = hbarRequired * 2n;

      // What a wallet's pre-flight sees: the refusal, before anything is signed or paid for.
      const simulated = await sale
        .connect(approved)
        .getFunction("buy")
        .staticCall(UNITS, inFuture(), { value: budget * WEIBAR_PER_TINYBAR })
        .then(
          () => "no revert",
          (error: { data?: string }) => decodeRevert(error.data ?? null, sale.interface),
        );
      expect(simulated).to.equal(`DeliveryFailed(${TOKEN_IS_PAUSED})`);

      const before = await snapshot(d, ethers.provider, approved.address);
      const { result, revert, maxFeeWeibar } = await buy(approved, budget, inFuture(), "paused asset");
      expect(result.result).to.equal("CONTRACT_REVERT_EXECUTED");
      expect(revert).to.equal(`DeliveryFailed(${TOKEN_IS_PAUSED})`);
      expectNothingSettled(before, await snapshot(d, ethers.provider, approved.address), maxFeeWeibar);
    } finally {
      const unpause = await new TokenUnpauseTransaction().setTokenId(tokenId).freezeWith(client).sign(pauseKey);
      await (await unpause.execute(client)).getReceipt(client);
      client.close();
      await waitForPauseStatus(d.assetTokenId, "UNPAUSED");
    }
  });

  it("9. the compliance wallet approves and revokes a buyer with plain EVM calls to 0x167", async function () {
    const buyer = d.buyers.unapproved;
    const before = await tokenRelationship(buyer.id, d.assetTokenId);
    expect(before?.kyc_status, "precondition: associated, not approved").to.equal("REVOKED");
    try {
      const grant = await kycCall(complianceWallet, "grantTokenKyc", buyer.evm, "compliance wallet grants KYC");
      expect(grant.result).to.equal("SUCCESS");
      expect(grant.returned, "HTS response code").to.equal(SUCCESS);
      await waitForRelationship(buyer.id, d.assetTokenId, r => r?.kyc_status === "GRANTED");

      const revoke = await kycCall(complianceWallet, "revokeTokenKyc", buyer.evm, "compliance wallet revokes KYC");
      expect(revoke.result).to.equal("SUCCESS");
      expect(revoke.returned, "HTS response code").to.equal(SUCCESS);
      await waitForRelationship(buyer.id, d.assetTokenId, r => r?.kyc_status === "REVOKED");
    } finally {
      // Test 2 needs this buyer unapproved on every run, so a failure here must not leave it granted.
      if ((await tokenRelationship(buyer.id, d.assetTokenId))?.kyc_status === "GRANTED") {
        const { client } = await issuer();
        const revoke = await new TokenRevokeKycTransaction()
          .setAccountId(AccountId.fromString(buyer.id))
          .setTokenId(TokenId.fromString(d.assetTokenId))
          .freezeWith(client)
          .sign(kycKey);
        await (await revoke.execute(client)).getReceipt(client);
        client.close();
      }
    }
  });

  it("10. a wallet without the KYC key cannot approve anyone, and its transaction still succeeds", async function () {
    const buyer = d.buyers.unapproved;
    // The buyer tries to approve itself. Its account key is not the asset's KYC key.
    const attempt = await kycCall(unapproved, "grantTokenKyc", buyer.evm, "self-approval without the KYC key");

    // The refusal is only in the return value: the Ethereum transaction itself succeeds, so a
    // frontend that trusts the receipt would report an approval that never happened. D36.
    expect(attempt.result).to.equal("SUCCESS");
    expect(attempt.returned, "HTS response code").to.equal(INVALID_SIGNATURE);
    // waitForContractResult already waited for the mirror node to ingest the call.
    expect((await tokenRelationship(buyer.id, d.assetTokenId))?.kyc_status).to.equal("REVOKED");
  });
});
