# Sanad

Sell a **permissioned** asset on Hedera for HBAR, in a single transaction.

The buyer pays HBAR. SaucerSwap V1 converts exactly enough of it into the issuer's settlement
token and pays the issuer. The asset is then delivered from the sale contract's inventory, and the
Hedera Token Service decides whether that delivery is allowed using the token's own KYC, freeze and
pause rules. If the network refuses, the swap and the payment are undone with it. There is no state
in which the buyer has paid and not been served.

_Sanad_ (سند) is Arabic for a deed or title: the document that says a thing is yours.

> **Status.** Built in the open for the Hedera Scaffold-HBAR Template Bounty. Today this repository
> scaffolds, installs, lints, builds and boots as a clean Hardhat and Next.js baseline. The sale
> contract, the screens and the testnet evidence arrive next, and each section below is filled in
> as its piece lands.

## Who this is for

You are issuing something that not everyone is allowed to hold: a fund unit, a regulated
instrument, a membership. You want buyers to pay in HBAR, you want to be paid in a stable unit, and
you need the "is this buyer allowed?" check to be enforced by the ledger rather than by your
frontend. Sanad is the smallest correct starting point for that, meant to be forked and changed.

## Quickstart

```bash
npm create scaffold-hbar@latest my-sanad -- --template <owner>/<repo>
```

The `--` is required. Without it npm keeps `--template` for itself and the CLI never sees it, which
silently gets you the default template instead of this one. The repository path is filled in here
when the repository is published.

## Prerequisites

- [Node.js](https://nodejs.org/) 20.18.3 or later
- Yarn 3 via Corepack (`corepack enable`), or npm 10+ if you scaffold with `--package-manager npm`
- Git with `user.name` and `user.email` set; the scaffold CLI refuses to run without them
- For testnet: an **ECDSA** account from the [Hedera Portal](https://portal.hedera.com) and test
  HBAR from its [faucet](https://portal.hedera.com/faucet)

## Environment variables

Each package reads its own `.env`, next to its `package.json`. Copy the `.env.example` beside it and
fill that in; a `.env` at the repository root is not read by anything. The full table lands with the
variables it documents.

## Architecture

Which contract holds what, which account signs what, and where the frontend reads from. Diagram to
follow with the contract.

## The purchase flow

The steps from "buyer connects a wallet" to "asset delivered", including the association and
approval that must happen before a purchase can succeed. Written once the flow exists end to end.

## What is guaranteed, and by whom

Sanad makes two different kinds of promise and the difference matters. Some are enforced by the
Hedera network itself and hold even against a buggy frontend or a direct contract call; others are
enforced only by the sale contract. Both lists go here, kept honest.

## Key custody

Who holds each of the admin, KYC, freeze, pause, wipe, supply and treasury keys, and what the holder
of each could do outside the sale contract. Table to follow with the deployment scripts.

## Why SaucerSwap, and why not just pay in the stablecoin

Because the two sides want different things. The buyer holds HBAR and does not want to go and
acquire a stablecoin first; the issuer needs to be paid in a stable unit and does not want price
risk between quote and settlement. Doing the conversion inside the purchase means the buyer spends
HBAR, the issuer receives exactly the settlement amount, and neither has to trust the other to
convert. If your buyers already hold your settlement token, you do not need Sanad's swap leg, and
the README will say so plainly rather than sell you the detour.

## Hedera traps this template handles

Hedera's EVM differs from Ethereum's in ways that cost real money to discover. The list of the ones
this template already deals with, each with the evidence, lands with the code that handles them.

## Customising it for your asset

What to change for a different asset, a different settlement token, or a different price, and which
invariants must not be broken while you do it.

## Honest limits

- Granting the KYC flag is a demo approval. It verifies nobody's identity and is not a
  compliance process.
- Token controls are not legal compliance. A freeze key is not a court order.
- Wipe burns units and reduces supply. It is not a clawback that returns them to the issuer.
- The demo settlement token is a test token created by the setup script, clearly labelled as such.
  It is not a real stablecoin and is not redeemable for anything.

## Sanad, Asset Tokenization Studio and Stablecoin Studio

[Asset Tokenization Studio](https://docs.hedera.com/solutions/tokenization/ats/index) and
[Stablecoin Studio](https://docs.hedera.com/solutions/tokenization/stablecoin/index) are full
platforms, with lifecycle management, roles and a UI. Sanad is not competing with them. It is a
template you fork when you want to understand and own the whole path, and it is deliberately small
enough to read in one sitting. If you need a securities platform, use the studios.

## Testnet evidence

Mirror node links for the transactions that prove the behaviour above, including the rollback.

## Troubleshooting

Symptoms and their causes, the Hedera ones especially, where the error text alone does not tell you
what to do next.

## Licence

MIT. See [LICENCE](LICENCE); the upstream Scaffold-HBAR and BuidlGuidl copyrights are kept alongside
Sanad's.
