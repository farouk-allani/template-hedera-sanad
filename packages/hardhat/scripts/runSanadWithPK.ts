import * as dotenv from "dotenv";
dotenv.config();
import { Wallet } from "ethers";
import password from "@inquirer/password";
import { spawn } from "child_process";

/**
 * Runs a hardhat command with the issuer key in the environment, because hardhat reads its config
 * before any script runs and the key has to be there by then.
 *
 *   ts-node scripts/runSanadWithPK.ts run scripts/sanad/setupTestnet.ts --network hederaTestnet
 *
 * Two ways to supply the key:
 *
 *   OPERATOR_KEY in packages/hardhat/.env — a hex ECDSA testnet key, used as-is. Convenient, and
 *     refused for any network other than hederaTestnet, because a plaintext mainnet key in a
 *     dotfile is how people lose real money.
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
      console.error("   Use an encrypted key (yarn account:import) for any other network.");
      process.exit(1);
    }
    console.log("Using OPERATOR_KEY from .env (plaintext, testnet only).");
    privateKey = plaintextKey.startsWith("0x") ? plaintextKey : `0x${plaintextKey}`;
  } else {
    const encryptedKey = process.env.DEPLOYER_PRIVATE_KEY_ENCRYPTED;
    if (!encryptedKey) {
      console.log("🚫️ No key. Set OPERATOR_KEY in packages/hardhat/.env for testnet,");
      console.log("   or run `yarn account:generate` / `yarn account:import` for an encrypted one.");
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

main().catch(console.error);
