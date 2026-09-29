/**
 * Builds a complete Sanad demo on Hedera testnet: a settlement token, a permissioned asset with a
 * different key for each of its six roles, an account for the compliance officer who holds the KYC
 * key, two buyers of which only one is approved, a SaucerSwap V1 pool, the sale contract, and its
 * opening inventory. It then publishes the sale to the asset's offering record (an HCS topic, see
 * offeringRecord.ts) and points the frontend at the new sale.
 *
 * Run it with `yarn sanad:setup` from the repository root, not directly: hardhat reads the
 * deployer key from its config before any script runs, and the wrapper is what puts it there.
 *
 * A finished run creates NEW tokens, a NEW pool and a NEW contract, so re-running costs testnet
 * HBAR again. A run that fails partway leaves .sanad/testnet.partial.json behind and the next run
 * resumes from it, reusing everything that already exists on-chain.
 */
import fs from "node:fs";
import hre from "hardhat";
import generateTsAbis from "../generateTsAbis";
import {
  AccountAllowanceApproveTransaction,
  AccountCreateTransaction,
  AccountId,
  AccountUpdateTransaction,
  Client,
  Hbar,
  PrivateKey,
  PublicKey,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenGrantKycTransaction,
  TokenId,
  TokenType,
  TransferTransaction,
} from "@hashgraph/sdk";
import {
  AccountRef,
  CHECKPOINT_FILE,
  DEPLOYMENT_FILE,
  Deployment,
  KEYS_FILE,
  ROLES,
  RoleName,
  SAUCERSWAP_V1_ROUTER_ID,
  StoredKeys,
  WEIBAR_PER_TINYBAR,
  contractEvmAddress,
  contractIdOf,
  decodeRevert,
  hashscan,
  issuer,
  mirror,
  mirrorTxUrl,
  readJson,
  waitForContractResult,
  writeJson,
} from "./hedera";
import { recordSaleOpened } from "./offeringRecord";

const CONFIG = {
  settlementDecimals: 6,
  settlementSupply: 1_000_000n, // whole sUSD minted to the issuer
  assetSupply: 10_000, // whole asset units (0 decimals)
  saleInventory: 1_000, // units moved into the sale contract
  pricePerUnit: 10n, // whole sUSD per asset unit
  poolHbar: 100n, // whole HBAR seeded into the pool
  poolSettlement: 1_000n, // whole sUSD seeded. Demo ratio: 1 HBAR ~ 10 sUSD
  buyerFundingHbar: 30,
  complianceFundingHbar: 5, // an approval or revocation costs about 0.04 HBAR
};

const ROUTER_ABI = [
  "function factory() view returns (address)",
  "function whbar() view returns (address)",
  "function addLiquidityETHNewPool(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)",
];
const FACTORY_ABI = [
  "function pairCreateFee() view returns (uint256)",
  "function getPair(address, address) view returns (address)",
];

const evm = (id: TokenId | AccountId) => "0x" + id.toSolidityAddress();
const step = (message: string) => console.log(`\n▸ ${message}`);

const checkpoint: Record<string, unknown> = fs.existsSync(CHECKPOINT_FILE) ? readJson(CHECKPOINT_FILE) : {};

/** Records each expensive step as soon as it exists on-chain, so a rerun never pays for it twice. */
async function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  if (checkpoint[key] !== undefined) {
    console.log(`  reusing ${key} from ${CHECKPOINT_FILE}`);
    return checkpoint[key] as T;
  }
  const value = await run();
  checkpoint[key] = value;
  writeJson(CHECKPOINT_FILE, checkpoint);
  return value;
}

/** Keys are written the moment they exist, so a run that dies can still reuse what it funded. */
function saveKey(name: string, key: string) {
  const keys: StoredKeys = fs.existsSync(KEYS_FILE) ? readJson<StoredKeys>(KEYS_FILE) : {};
  writeJson(KEYS_FILE, { ...keys, [name]: key });
}

function loadRoleKeys(): Record<RoleName, PrivateKey> {
  const stored: StoredKeys = fs.existsSync(KEYS_FILE) ? readJson<StoredKeys>(KEYS_FILE) : {};
  const result = {} as Record<RoleName, PrivateKey>;
  for (const role of ROLES) {
    const existing = stored[role];
    if (existing) {
      result[role] = PrivateKey.fromStringECDSA(existing.replace(/^0x/, ""));
    } else {
      const generated = PrivateKey.generateECDSA();
      saveKey(role, "0x" + generated.toStringRaw());
      result[role] = generated;
    }
  }
  return result;
}

async function main() {
  const { client, accountId, evmAddress, key } = await issuer();
  try {
    await run(client, accountId, evmAddress, key.publicKey);
  } finally {
    client.close(); // an open client keeps node alive, even after an error
  }
}

async function run(client: Client, issuerId: AccountId, issuerEvm: string, issuerKey: PublicKey) {
  if (Object.keys(checkpoint).length > 0) console.log(`Resuming the run recorded in ${CHECKPOINT_FILE}`);
  const { ethers, deployments, getNamedAccounts } = hre;

  step(`Issuer ${issuerId} (${issuerEvm})`);
  const account = await mirror<{ max_automatic_token_associations: number }>(`/api/v1/accounts/${issuerId}`);
  if (account.max_automatic_token_associations !== -1) {
    // The pool's LP token is created and sent to us in the same transaction, so it cannot be
    // associated beforehand. Unlimited auto-association lets the mint land.
    console.log("  enabling unlimited auto-association so the LP token can arrive");
    await (
      await new AccountUpdateTransaction().setAccountId(issuerId).setMaxAutomaticTokenAssociations(-1).execute(client)
    ).getReceipt(client);
  }

  step("Generating a separate key for each token role");
  const roleKeys = loadRoleKeys();
  for (const role of ROLES) console.log(`  ${role.padEnd(7)} ${roleKeys[role].publicKey.toStringRaw().slice(0, 24)}…`);

  step("Creating the demo settlement token (sUSD, test only)");
  const settlementTokenId = TokenId.fromString(
    await once("settlementTokenId", async () => {
      const tx = await new TokenCreateTransaction()
        .setTokenName("Sanad Demo USD (test only)")
        .setTokenSymbol("sUSD")
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(CONFIG.settlementDecimals)
        .setInitialSupply(Number(CONFIG.settlementSupply * 10n ** BigInt(CONFIG.settlementDecimals)))
        .setTreasuryAccountId(issuerId)
        .setAdminKey(roleKeys.admin.publicKey)
        .setSupplyKey(roleKeys.supply.publicKey)
        .freezeWith(client)
        .sign(roleKeys.admin);
      return (await (await tx.execute(client)).getReceipt(client)).tokenId!.toString();
    }),
  );
  console.log(`  ${settlementTokenId}  ${hashscan("token", settlementTokenId.toString())}`);

  step("Creating the permissioned asset, one key per role");
  const assetTokenId = TokenId.fromString(
    await once("assetTokenId", async () => {
      const tx = await new TokenCreateTransaction()
        .setTokenName("Sanad Demo Fund Unit (test only)")
        .setTokenSymbol("SDFU")
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(0)
        .setInitialSupply(CONFIG.assetSupply)
        .setTreasuryAccountId(issuerId)
        .setAdminKey(roleKeys.admin.publicKey)
        .setKycKey(roleKeys.kyc.publicKey)
        .setFreezeKey(roleKeys.freeze.publicKey)
        .setPauseKey(roleKeys.pause.publicKey)
        .setWipeKey(roleKeys.wipe.publicKey)
        .setSupplyKey(roleKeys.supply.publicKey)
        .setFreezeDefault(false)
        .freezeWith(client)
        .sign(roleKeys.admin);
      return (await (await tx.execute(client)).getReceipt(client)).tokenId!.toString();
    }),
  );
  console.log(`  ${assetTokenId}  ${hashscan("token", assetTokenId.toString())}`);

  async function createAliasedAccount(key: PrivateKey, hbar: number): Promise<AccountRef> {
    const createTx = await new AccountCreateTransaction()
      .setECDSAKeyWithAlias(key)
      .setInitialBalance(new Hbar(hbar))
      .setMaxAutomaticTokenAssociations(0) // association is explicit, like real onboarding
      .freezeWith(client)
      .sign(key);
    const id = (await (await createTx.execute(client)).getReceipt(client)).accountId!;
    return { id: id.toString(), evm: "0x" + key.publicKey.toEvmAddress().replace(/^0x/, "") };
  }

  step("Creating the compliance officer's account, controlled by the KYC key");
  // Buyers are approved by a wallet whose account key is the KYC key, calling the HTS system
  // contract directly. Without an account behind the key, no wallet could approve anyone.
  const complianceOfficer = await once("complianceOfficer", () =>
    createAliasedAccount(roleKeys.kyc, CONFIG.complianceFundingHbar),
  );
  console.log(`  ${complianceOfficer.id}  ${complianceOfficer.evm}`);

  step("Creating two buyers, both associated with the asset");
  async function createBuyer(label: "approved" | "unapproved"): Promise<AccountRef> {
    const key = PrivateKey.generateECDSA();
    const buyer = await createAliasedAccount(key, CONFIG.buyerFundingHbar);
    saveKey(`buyer.${label}`, "0x" + key.toStringRaw());
    const associate = await new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(buyer.id))
      .setTokenIds([assetTokenId])
      .freezeWith(client)
      .sign(key);
    await (await associate.execute(client)).getReceipt(client);
    return buyer;
  }
  const approved = await once("buyer.approved", () => createBuyer("approved"));
  const unapproved = await once("buyer.unapproved", () => createBuyer("unapproved"));
  console.log(`  approved:   ${approved.id}  ${approved.evm}`);
  console.log(`  unapproved: ${unapproved.id}  ${unapproved.evm}`);

  step("Granting KYC to the approved buyer only (a demo approval, not identity verification)");
  await once("kyc.approvedBuyer", async () => {
    const tx = await new TokenGrantKycTransaction()
      .setAccountId(AccountId.fromString(approved.id))
      .setTokenId(assetTokenId)
      .freezeWith(client)
      .sign(roleKeys.kyc);
    await (await tx.execute(client)).getReceipt(client);
    return true;
  });

  step("Creating and seeding the SaucerSwap V1 pool: WHBAR / sUSD");
  const [signer] = await ethers.getSigners();
  const routerAddr = await contractEvmAddress(SAUCERSWAP_V1_ROUTER_ID);
  const router = new ethers.Contract(routerAddr, ROUTER_ABI, signer);
  const factoryAddr: string = await router.factory();
  const whbarToken: string = await router.whbar();
  const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, signer);

  const settlementEvm = evm(settlementTokenId);
  const settlementLiquidity = CONFIG.poolSettlement * 10n ** BigInt(CONFIG.settlementDecimals);
  const feeTinycents: bigint = await factory.pairCreateFee();
  const { current_rate } = await mirror<{ current_rate: { cent_equivalent: number; hbar_equivalent: number } }>(
    "/api/v1/network/exchangerate",
  );
  const feeTinybars = (feeTinycents * BigInt(current_rate.hbar_equivalent)) / BigInt(current_rate.cent_equivalent);
  const valueTinybars = CONFIG.poolHbar * 100_000_000n + (feeTinybars * 105n) / 100n;
  console.log(`  pool creation fee ≈ ${Number(feeTinybars) / 1e8} HBAR`);

  await once("routerAllowance", async () => {
    // The router pulls sUSD from the issuer through HTS, so it needs an allowance.
    await (
      await new AccountAllowanceApproveTransaction()
        .approveTokenAllowance(
          settlementTokenId,
          issuerId,
          AccountId.fromString(SAUCERSWAP_V1_ROUTER_ID),
          Number(settlementLiquidity),
        )
        .execute(client)
    ).getReceipt(client);
    return true;
  });

  const pair = await once("pair", async () => {
    const existing: string = await factory.getPair(settlementEvm, whbarToken);
    if (existing !== ethers.ZeroAddress) return existing;
    const deadline = Math.floor(Date.now() / 1000) + 600;
    // Successful pool creations on testnet use ~6.8M gas: CREATE2 of the pair, the LP token
    // creation and several HTS associations. 5M reverts inside an association.
    const poolTx = await router.addLiquidityETHNewPool(
      settlementEvm,
      settlementLiquidity,
      0,
      0,
      signer.address,
      deadline,
      { value: valueTinybars * WEIBAR_PER_TINYBAR, gasLimit: 9_000_000 },
    );
    await poolTx.wait().catch(() => null); // a revert is reported below, decoded
    const result = await waitForContractResult(poolTx.hash);
    if (result.result !== "SUCCESS") {
      throw new Error(
        `Pool creation failed: ${decodeRevert(result.error_message, router.interface)}\n  ${mirrorTxUrl(poolTx.hash)}`,
      );
    }
    return (await factory.getPair(settlementEvm, whbarToken)) as string;
  });
  console.log(`  pair ${pair}`);

  step("Deploying SanadSale");
  const pricePerUnit = CONFIG.pricePerUnit * 10n ** BigInt(CONFIG.settlementDecimals);
  const { deployer } = await getNamedAccounts();
  // Deployed through hardhat-deploy so the address and ABI land in deployments/ and reach the
  // frontend, and so a rerun reuses the existing deployment rather than paying for a new one.
  const deployed = await deployments.deploy("SanadSale", {
    from: deployer,
    // The issuer treasury must be the account's EVM alias. HTS refuses the long-zero form of an
    // aliased account: the pool's payout returned INVALID_ALIAS_KEY (282).
    args: [routerAddr, evm(assetTokenId), settlementEvm, issuerEvm, pricePerUnit],
    log: true,
    autoMine: true,
  });
  const sanadId = await contractIdOf(deployed.address);
  console.log(`  ${sanadId}  ${hashscan("contract", sanadId)}`);
  // hardhat-deploy's `deploy` task regenerates the frontend's contract list; `hardhat run`, which
  // runs this script, does not. Without this the app would keep pointing at the previous sale.
  await generateTsAbis(hre);

  step("Associating the sale contract, granting it KYC, and moving inventory in");
  await once("sanad.associate", async () => {
    const sale = await ethers.getContractAt("SanadSale", deployed.address, signer);
    await (await sale.associateAsset({ gasLimit: 1_000_000 })).wait();
    return true;
  });
  await once("sanad.kyc", async () => {
    const tx = await new TokenGrantKycTransaction()
      .setAccountId(AccountId.fromString(sanadId))
      .setTokenId(assetTokenId)
      .freezeWith(client)
      .sign(roleKeys.kyc);
    await (await tx.execute(client)).getReceipt(client);
    return true;
  });
  await once("sanad.inventory", async () => {
    await (
      await new TransferTransaction()
        .addTokenTransfer(assetTokenId, issuerId, -CONFIG.saleInventory)
        .addTokenTransfer(assetTokenId, AccountId.fromString(sanadId), CONFIG.saleInventory)
        .execute(client)
    ).getReceipt(client);
    return CONFIG.saleInventory;
  });

  step("Publishing the sale to the asset's offering record");
  await recordSaleOpened(client, issuerKey, {
    sale: sanadId,
    address: deployed.address.toLowerCase(),
    asset: assetTokenId.toString(),
    settlement: settlementTokenId.toString(),
    pricePerUnit: pricePerUnit.toString(),
    treasury: issuerEvm.toLowerCase(),
    router: SAUCERSWAP_V1_ROUTER_ID,
  });

  const deployment: Deployment = {
    createdAt: new Date().toISOString(),
    issuerAccountId: issuerId.toString(),
    issuerTreasury: issuerEvm,
    routerId: SAUCERSWAP_V1_ROUTER_ID,
    router: routerAddr,
    factory: factoryAddr,
    whbarToken,
    pair,
    settlementTokenId: settlementTokenId.toString(),
    settlementToken: settlementEvm,
    assetTokenId: assetTokenId.toString(),
    asset: evm(assetTokenId),
    sanad: deployed.address,
    sanadId,
    pricePerUnit: pricePerUnit.toString(),
    complianceOfficer,
    buyers: { approved, unapproved },
  };
  writeJson(DEPLOYMENT_FILE, deployment);
  fs.rmSync(CHECKPOINT_FILE, { force: true }); // finished; the next run starts fresh
  console.log(`\n✓ Setup complete. Wrote ${DEPLOYMENT_FILE}`);
  console.log(`  To approve buyers from the app, import the "kyc" key from ${KEYS_FILE} into your wallet.`);
  console.log(`  It controls ${complianceOfficer.id} (${complianceOfficer.evm}), a throwaway testnet account.`);
  console.log("  Next: yarn sanad:test");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
