import * as chains from "viem/chains";

export type ScaffoldConfig = {
  targetNetworks: readonly [chains.Chain, ...chains.Chain[]];
  pollingInterval: number;
  rpcOverrides?: Record<number, string>;
  enableBurnerWallet: boolean;
  walletConnectProjectId: string;
};

// Testnet only. SanadSale reads a live SaucerSwap router when it is deployed, so it cannot exist on
// a local node, and mainnet has no deployment and holds real value.
const targetNetworks = [chains.hederaTestnet] as const satisfies readonly [chains.Chain, ...chains.Chain[]];

const scaffoldConfig = {
  targetNetworks,

  pollingInterval: 10000,

  // A burner key lives in one browser's storage and starts with no Hedera account. A buyer of a
  // permissioned asset needs a wallet they keep, because that account is what the issuer approves.
  enableBurnerWallet: false,

  rpcOverrides: {
    [chains.hederaTestnet.id]: process.env.NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api",
  },

  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || "3a8170812b534d0ff9d794f19a901d64",
} as const satisfies ScaffoldConfig;

export default scaffoldConfig;
