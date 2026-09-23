# Agent instructions

The shared briefing for coding agents working in this repository (Cursor, Claude Code, Codex, and
anything else that reads `AGENTS.md`). Claude Code loads it through `CLAUDE.md`.

## What this repository is

Sanad sells a permissioned Hedera Token Service asset for HBAR. One transaction converts the
buyer's HBAR to the issuer's settlement token through SaucerSwap V1, pays the issuer, and delivers
the asset. The Hedera Token Service applies the token's KYC, freeze and pause rules at the moment
of delivery; if it refuses, the whole transaction reverts and nothing settles.

Two packages:

- **packages/hardhat**: Solidity contracts, deployed with the hardhat-deploy plugin
- **packages/nextjs**: Next.js App Router frontend (RainbowKit, wagmi, viem, Tailwind with DaisyUI)

## Invariants

These are the point of the template. Breaking one silently turns a correct sale into a way to lose
someone's money, so do not "simplify" any of them without being asked.

1. **Never let a Hedera Token Service call fail quietly.** The HTS system contract at `0x167`
   *returns* a response code; it does not revert. An unchecked non-success code means the buyer
   paid and received nothing. Every call checks its code and reverts carrying it.
2. **Do not add a KYC, freeze or pause check to the sale contract.** Those rules belong to the
   token and the network enforces them at delivery. A contract-level check fails earlier but is not
   the guarantee, and having both invites the belief that removing the network's is safe. The
   frontend may pre-check to show a better message.
3. **Settlement and delivery stay in one transaction.** Splitting them, or catching the delivery
   failure to "handle it gracefully", reintroduces exactly the state this template exists to
   prevent.
4. **Address aliased (ECDSA) accounts by their `evm_address`,** never by the long-zero form. HTS
   rejects transfers to the long-zero address of an account that has an alias, with
   `INVALID_ALIAS_KEY` (282).
5. **The issuer must be able to withdraw unsold inventory.** A sale contract that can strand the
   asset is not finished.

## Where things live

- Contracts: `packages/hardhat/contracts/`
- Deploy scripts: `packages/hardhat/deploy/` (hardhat-deploy; `snake_case` filenames)
- Tests: `packages/hardhat/test/`
- Hardhat config and networks: `packages/hardhat/hardhat.config.ts`
- Frontend config and networks: `packages/nextjs/scaffold.config.ts`
- After a deploy, ABIs are generated into `packages/nextjs/contracts/deployedContracts.ts`; never
  edit that by hand. `yarn sanad:setup` regenerates it too.
- `packages/hardhat/deployments/hederaTestnet/SanadSale.json` is committed deliberately. The
  contract list is rebuilt from `deployments/` on every deploy, so deleting or ignoring that record
  silently removes the sale from the app. Other deployment records stay gitignored.

## Verifying a change

```bash
yarn lint                # both packages, and CI runs it with --max-warnings=0
yarn next:check-types
yarn hardhat:compile
yarn hardhat:test        # against a fork of testnet; reaches the RPC, spends no HBAR
yarn next:build
```

`yarn hardhat:test` is not offline. The `hardhat` network is configured with
`forking: { url: <Hedera RPC>, chainId: 296 }`, so the suite runs against a fork of testnet and
needs the RPC to be reachable. What it must never need is a funded key: anything that spends HBAR
belongs in a separate, explicitly named script.

The fork emulates only part of the Hedera Token Service. `associateToken`, `transferToken`,
`balanceOf` and `getTokenInfo` work; **KYC, freeze and pause do not exist there at all**, so no
local test can prove the behaviour Sanad is built around. Those live in the testnet suite. Do not
"fix" a local test by asserting a KYC outcome the fork cannot produce.

## Hedera specifics that are easy to get wrong

- **Units.** Inside a contract, HBAR values (`msg.value`, balances) are tinybars, 8 decimals.
  Clients send weibars, 18 decimals, and the JSON-RPC relay converts. Mixing them is a 10^10 error.
- **`receive()` is not a guard.** Hedera does not trigger `receive()` or `fallback()` on native
  HBAR transfers, so a contract's balance can change without its code running. Use explicit
  functions for HBAR, and do not treat "only the router can send me HBAR" as airtight.
- **Reads go through the mirror node.** A balance read immediately after a receipt can be stale.
  Wait for the mirror node to ingest the transaction before asserting on state.
- **SaucerSwap has two WHBAR addresses.** `WHBAR()` is the wrapper contract and `whbar()` is the
  HTS token. Swap paths must start with the token, or the router reverts with `INVALID_PATH`.

## Frontend contract interaction

Use the hooks in `packages/nextjs/hooks/scaffold-hbar` for the sale contract. The names are
`useScaffoldReadContract` and `useScaffoldWriteContract`, not `useScaffoldContractRead` /
`useScaffoldContractWrite`.

```typescript
const { data: quote } = useScaffoldReadContract({
  contractName: "SanadSale",
  functionName: "quote",
  args: [units],
});

// Simulate as the buyer first: the network's refusals show up here, before anything is signed.
await publicClient.simulateContract({ address, abi, functionName: "buy", args, value, account: buyer });

const { writeContractAsync } = useScaffoldWriteContract({ contractName: "SanadSale", disableSimulate: true });
await writeContractAsync({ functionName: "buy", args: [units, deadline], value });
```

`quote` returns tinybars and a wallet sends weibars, so every HBAR value attached to a transaction
is tinybars × 10^10 (`WEIBARS_PER_TINYBAR` in `packages/nextjs/utils/sanad/format.ts`).

Token state (KYC, freeze, pause, associations, key custody) comes from the Hedera mirror node
through `packages/nextjs/hooks/sanad/useMirror.ts`, not from contract reads.
`packages/nextjs/hooks/sanad/useSale.ts` combines the contract's fixed terms with that state.

Contract data comes from two files in `packages/nextjs/contracts/`: `deployedContracts.ts`
(generated) and `externalContracts.ts` (hand-written, for contracts we do not deploy).

## UI components

`@scaffold-hbar-ui/components` provides `Address`, `Balance`, `HederaAddress`, `HederaAddressInput`,
`HbarInput`, `BaseInput` and `HederaPortalFaucet`. The components Sanad's screens share are in
`packages/nextjs/components/sanad/`.

## Styling

Use DaisyUI classes rather than raw Tailwind where DaisyUI has a component.

```tsx
<button className="btn btn-primary">Connect</button>   // good
<button className="px-4 py-2 bg-blue-500 rounded">Connect</button>   // avoid
```

## Code style

| Style            | Applies to                                                            |
| ---------------- | --------------------------------------------------------------------- |
| `UpperCamelCase` | class, interface, type, enum, decorator, type parameter, TSX component |
| `lowerCamelCase` | variable, parameter, function, property, module alias                  |
| `CONSTANT_CASE`  | constants and global variables                                         |
| `snake_case`     | hardhat deploy filenames                                               |

- Import with the `~~` alias in the nextjs package: `import { x } from "~~/hooks/scaffold-hbar"`.
- Prefer `type` over `interface`; no `T` prefix on type names.
- Let TypeScript infer what it can.
- Every Solidity function carries NatSpec. Use custom errors, not revert strings.
- Comments explain *why*, cite the Hedera rule that forces the code, or warn. A comment that
  restates the line below it is noise; delete it.
