import * as dotenv from "dotenv";
dotenv.config();
import { Wallet } from "ethers";
import password from "@inquirer/password";
import { PrivateKey } from "@hashgraph/sdk";
import { spawn } from "child_process";

/**
 * Runs a hardhat command with the issuer key in the environment, because hardhat reads its config
 * before any script runs and the key has to be there by then.
 *
 *   ts-node scripts/runSanadWithPK.ts run scripts/sanad/setupTestnet.ts --network hederaTestnet
 *
 * Two ways to supply the key:
 *
 *   OPERATOR_KEY in packages/hardhat/.env — an ECDSA testnet key, hex or DER, used as-is.
 *     Convenient, and refused for any network other than hederaTestnet, because a plaintext mainnet
 *     key in a dotfile is how people lose real money.
 *   DEPLOYER_PRIVATE_KEY_ENCRYPTED — upstream's encrypted key, unlocked with a password prompt.
 *     Use this one for anything that matters.
 */
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: runSanadWithPK.ts <hardhat command and arguments>");
    process.exit(1);
  }

  const networkIndex = args.indexOf("--network");
  const network = networkIndex === -1 ? "" : args[networkIndex + 1];

  const plaintextKey = process.env.OPERATOR_KEY?.trim();
  let privateKey: string | undefined;

  if (plaintextKey) {
    if (network !== "hederaTestnet") {
      console.error(`🚫 OPERATOR_KEY is a plaintext key and is only accepted for hederaTestnet, not ${network}.`);
      console.error("   Use an encrypted key (yarn hardhat:account:import) for any other network.");
      process.exit(1);
    }
    console.log("Using OPERATOR_KEY from .env (plaintext, testnet only).");
    privateKey = toRawEcdsaHex(plaintextKey);
  } else {
    const encryptedKey = process.env.DEPLOYER_PRIVATE_KEY_ENCRYPTED;
    if (!encryptedKey) {
      console.log("🚫️ No key. Set OPERATOR_KEY in packages/hardhat/.env for testnet,");
      console.log("   or run `yarn hardhat:account:generate` / `yarn hardhat:account:import` for an encrypted one.");
      return;
    }
    const pass = await password({ message: "Enter password to decrypt private key:" });
    try {
      privateKey = (await Wallet.fromEncryptedJson(encryptedKey, pass)).privateKey;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      console.error("Failed to decrypt private key. Wrong password?");
      process.exit(1);
    }
  }

  const hardhat = spawn("hardhat", args, {
    stdio: "inherit",
    env: { ...process.env, __RUNTIME_DEPLOYER_PRIVATE_KEY: privateKey },
    shell: process.platform === "win32",
  });

  hardhat.on("exit", code => process.exit(code || 0));
}

/**
 * Returns the key as 0x-prefixed raw hex, the only form hardhat accepts. The Hedera Portal shows an
 * ECDSA key both as raw hex and DER-encoded (3030…), and Hedera's own guides use the DER form, which
 * hardhat would otherwise reject as "private key too long".
 */
function toRawEcdsaHex(supplied: string): string {
  const hex = supplied.replace(/^0x/, "");
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return `0x${hex}`;

  let key: PrivateKey;
  try {
    key = PrivateKey.fromStringDer(hex);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    console.error("🚫 OPERATOR_KEY is neither a 64-character hex key nor a DER-encoded key.");
    console.error("   Copy the HEX or DER private key of an ECDSA account from https://portal.hedera.com.");
    process.exit(1);
  }
  if (key.type !== "secp256k1") {
    console.error(`🚫 OPERATOR_KEY is an ${key.type} key. Sanad sends EVM transactions, which only an`);
    console.error("   ECDSA (secp256k1) account can sign. Create an ECDSA account at https://portal.hedera.com.");
    process.exit(1);
  }
  return `0x${key.toStringRaw()}`;
}

main().catch(console.error);
