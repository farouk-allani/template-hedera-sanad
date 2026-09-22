import * as dotenv from "dotenv";
dotenv.config();
import { Wallet } from "ethers";
import password from "@inquirer/password";
import { spawn } from "child_process";

/**
 * Decrypts the deployer key and runs a hardhat command with it, the same way `yarn deploy` does.
 * The key reaches hardhat's config through the environment, and config is read before any script
 * runs, so the decryption cannot happen inside the script that needs it.
 *
 * Everything after the script name is passed to hardhat:
 *   ts-node scripts/runSanadWithPK.ts run scripts/sanad/setupTestnet.ts --network hederaTestnet
 */
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: runSanadWithPK.ts <hardhat command and arguments>");
    process.exit(1);
  }

  const encryptedKey = process.env.DEPLOYER_PRIVATE_KEY_ENCRYPTED;
  if (!encryptedKey) {
    console.log("🚫️ You don't have a deployer account. Run `yarn account:generate` or `yarn account:import` first");
    return;
  }

  const pass = await password({ message: "Enter password to decrypt private key:" });

  let privateKey: string;
  try {
    privateKey = (await Wallet.fromEncryptedJson(encryptedKey, pass)).privateKey;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    console.error("Failed to decrypt private key. Wrong password?");
    process.exit(1);
  }

  const hardhat = spawn("hardhat", args, {
    stdio: "inherit",
    env: { ...process.env, __RUNTIME_DEPLOYER_PRIVATE_KEY: privateKey },
    shell: process.platform === "win32",
  });

  hardhat.on("exit", code => process.exit(code || 0));
}

main().catch(console.error);
