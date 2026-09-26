/**
 * Deploys a SanadSale for an asset and a settlement token that already exist: what you run once you
 * move past the demo tokens `sanad:setup` creates. It then associates the sale with the asset, tops
 * its inventory up, and points the frontend at it.
 *
 * Configure it in packages/hardhat/.env and run it with `yarn sanad:deploy` from the repository root:
 *   SANAD_ASSET_ID       the asset to sell, e.g. 0.0.1234. Whole units only (0 decimals).
 *   SANAD_SETTLEMENT_ID  the token the issuer is paid in. It needs a SaucerSwap V1 pool against WHBAR.
 *   SANAD_PRICE          price of one unit, in whole settlement tokens, e.g. 10 or 2.5.
 *   SANAD_INVENTORY      how many units the sale should hold. Moved from the signing account.
 *   SANAD_TREASURY       optional: the account paid for each sale. Defaults to the signing account.
 *
 * It never signs with the asset's KYC key. If the asset has one, the sale contract has to be approved
 * by whoever holds it before it can hold units; the script stops, says how, and a rerun carries on.
 * Rerunning with unchanged settings reuses the deployed sale.
 */
import hre from "hardhat";
import { AccountId, Client, TokenId, TransferTransaction } from "@hashgraph/sdk";
import generateTsAbis from "../generateTsAbis";
import {
  SAUCERSWAP_V1_ROUTER_ID,
  contractEvmAddress,
  contractIdOf,
  hashscan,
  issuer,
  mirror,
  tokenRelationship,
  waitForRelationship,
} from "./hedera";

const ROUTER_ABI = ["function factory() view returns (address)", "function whbar() view returns (address)"];
const FACTORY_ABI = ["function getPair(address, address) view returns (address)"];

interface MirrorToken {
  token_id: string;
  symbol: string;
  decimals: string;
  type: string;
  kyc_key: object | null;
}

/** A setting or on-chain state that stops the deployment. Printed as a message, not a stack trace. */
class Refusal extends Error {}

const step = (message: string) => console.log(`\n▸ ${message}`);
const evm = (id: string) => "0x" + TokenId.fromString(id).toSolidityAddress();

function setting(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Refusal(
      `Set ${name} in packages/hardhat/.env. "Customising it for your asset" in the README explains each setting.`,
    );
  }
  return value;
}

async function main() {
  const assetId = setting("SANAD_ASSET_ID");
  const settlementId = setting("SANAD_SETTLEMENT_ID");
  const price = setting("SANAD_PRICE");
  const inventory = Number(setting("SANAD_INVENTORY"));
  if (!Number.isSafeInteger(inventory) || inventory < 0) {
    throw new Refusal("SANAD_INVENTORY must be a whole number of units, 0 or more.");
  }

  const { client, accountId, evmAddress } = await issuer();
  try {
    await deploy(client, accountId, evmAddress, { assetId, settlementId, price, inventory });
  } finally {
    client.close(); // an open client keeps node alive, even after an error
  }
}

async function deploy(
  client: Client,
  signerId: AccountId,
  signerEvm: string,
  settings: { assetId: string; settlementId: string; price: string; inventory: number },
) {
  const { ethers, deployments, getNamedAccounts } = hre;
  const [signer] = await ethers.getSigners();

  step("Checking the asset and the settlement token");
  const asset = await mirror<MirrorToken>(`/api/v1/tokens/${settings.assetId}`);
  const settlement = await mirror<MirrorToken>(`/api/v1/tokens/${settings.settlementId}`);
  for (const token of [asset, settlement]) {
    if (token.type !== "FUNGIBLE_COMMON") throw new Refusal(`${token.token_id} is not a fungible token.`);
  }
  if (asset.decimals !== "0") {
    throw new Refusal(
      `${asset.symbol} has ${asset.decimals} decimals. Sanad sells whole units: the contract, the quote and ` +
        "the app all count units of the smallest denomination, so use an asset with 0 decimals.",
    );
  }
  console.log(`  asset       ${asset.symbol} ${asset.token_id}`);
  console.log(`  settlement  ${settlement.symbol} ${settlement.token_id}, ${settlement.decimals} decimals`);
  if (!asset.kyc_key) {
    console.log(`  note: ${asset.symbol} has no KYC key, so anyone who associates can buy. That is a public sale.`);
  }
  let pricePerUnit: bigint;
  try {
    pricePerUnit = ethers.parseUnits(settings.price, Number(settlement.decimals));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    throw new Refusal(`SANAD_PRICE must be a number with at most ${settlement.decimals} decimal places.`);
  }
  if (pricePerUnit <= 0n) throw new Refusal("SANAD_PRICE must be more than 0.");

  step(`Checking SaucerSwap V1 (router ${SAUCERSWAP_V1_ROUTER_ID}) for a WHBAR/${settlement.symbol} pool`);
  const routerAddr = await contractEvmAddress(SAUCERSWAP_V1_ROUTER_ID);
  const router = new ethers.Contract(routerAddr, ROUTER_ABI, signer);
  const factory = new ethers.Contract(await router.factory(), FACTORY_ABI, signer);
  const pair: string = await factory.getPair(evm(settlement.token_id), await router.whbar());
  if (pair === ethers.ZeroAddress) {
    throw new Refusal(
      `SaucerSwap V1 has no WHBAR/${settlement.symbol} pool, and every purchase swaps through one. ` +
        "Choose a settlement token that has one, or create and seed it (setupTestnet.ts shows how).",
    );
  }
  console.log(`  pair ${pair}`);

  step("Checking the account the issuer is paid into");
  const treasuryId = process.env.SANAD_TREASURY?.trim() || signerId.toString();
  // The mirror node gives an aliased account's alias and anyone else's long-zero address, which is
  // the form HTS accepts for each: paying an aliased account's long-zero address fails with 282.
  const treasury = await mirror<{ account: string; evm_address: string }>(`/api/v1/accounts/${treasuryId}`);
  const payee = await tokenRelationship(treasury.account, settlement.token_id);
  if (!payee) {
    throw new Refusal(`${treasury.account} is not associated with ${settlement.symbol}, so it cannot be paid in it.`);
  }
  if (payee.kyc_status === "REVOKED" || payee.freeze_status === "FROZEN") {
    throw new Refusal(`${treasury.account} is not allowed to receive ${settlement.symbol} (KYC or freeze).`);
  }
  console.log(`  ${treasury.account} (${treasury.evm_address})`);

  step(`Checking that ${signerId} can stock the sale with ${settings.inventory} ${asset.symbol}`);
  const { deployer } = await getNamedAccounts();
  const deployOptions = {
    from: deployer,
    args: [routerAddr, evm(asset.token_id), evm(settlement.token_id), treasury.evm_address, pricePerUnit],
    log: true,
    autoMine: true,
  };
  // Settled before anything is spent: a sale that cannot be stocked is not worth deploying.
  const { differences, address: reusable } = await deployments.fetchIfDifferent("SanadSale", deployOptions);
  const stocked =
    !differences && reusable
      ? ((await tokenRelationship(await contractIdOf(reusable), asset.token_id))?.balance ?? 0)
      : 0;
  const needed = settings.inventory - stocked;
  if (needed > 0) {
    const source = await tokenRelationship(signerId.toString(), asset.token_id);
    if (!source || source.balance < needed) {
      throw new Refusal(`${signerId} holds ${source?.balance ?? 0} ${asset.symbol}; the sale needs ${needed} more.`);
    }
    if (source.kyc_status === "REVOKED" || source.freeze_status === "FROZEN") {
      throw new Refusal(
        `${signerId} is not allowed to send ${asset.symbol} (KYC or freeze), so it cannot stock the sale.`,
      );
    }
  }
  console.log(`  ${needed > 0 ? `${needed} to move` : "already stocked"}`);

  step("Deploying SanadSale");
  const previous = await deployments.getOrNull("SanadSale");
  const deployed = await deployments.deploy("SanadSale", deployOptions);
  const saleId = await contractIdOf(deployed.address);
  console.log(`  ${saleId}  ${hashscan("contract", saleId)}`);
  if (previous && previous.address !== deployed.address) {
    console.log(`  replaces ${previous.address} as the sale the app points at`);
  }
  // `hardhat run` does not regenerate the frontend's contract list the way the deploy task does.
  await generateTsAbis(hre);

  step(`Associating the sale with ${asset.symbol}`);
  const sale = await ethers.getContractAt("SanadSale", deployed.address, signer);
  let holding = await tokenRelationship(saleId, asset.token_id);
  if (holding) {
    console.log("  already associated");
  } else {
    await (await sale.associateAsset({ gasLimit: 1_000_000 })).wait();
    holding = (await waitForRelationship(saleId, asset.token_id, rel => rel !== undefined))!;
    console.log("  associated");
  }

  if (asset.kyc_key && holding.kyc_status !== "GRANTED") {
    step("Waiting for the holder of the KYC key");
    console.log(`  ${asset.symbol} has a KYC key, so the sale must be approved before it can hold or deliver units.`);
    console.log("  This script does not hold that key. With the wallet that does, start the app and open");
    console.log(`    http://localhost:3000/issuer?account=${saleId}`);
    console.log("  press Approve, then run `yarn sanad:deploy` again to move the inventory in.");
    return;
  }

  step(`Topping the inventory up to ${settings.inventory} ${asset.symbol}`);
  const missing = settings.inventory - holding.balance;
  if (missing <= 0) {
    console.log(`  the sale holds ${holding.balance}; nothing to move`);
  } else {
    await (
      await new TransferTransaction()
        .addTokenTransfer(asset.token_id, signerId, -missing)
        .addTokenTransfer(asset.token_id, AccountId.fromString(saleId), missing)
        .execute(client)
    ).getReceipt(client);
    console.log(`  moved ${missing} from ${signerId}`);
  }

  const [hbarRequired] = await sale.quote(1);
  console.log(`\n✓ ${saleId} sells ${asset.symbol} at ${settings.price} ${settlement.symbol} a unit.`);
  console.log(`  One unit costs ${ethers.formatUnits(hbarRequired, 8)} HBAR at the pool's current reserves.`);
  console.log(`  The frontend now points at it. Signed by ${signerId} (${signerEvm}), which owns the sale.`);
}

main().catch(error => {
  console.error(error instanceof Refusal ? `\n🚫 ${error.message}` : error);
  process.exitCode = 1;
});
