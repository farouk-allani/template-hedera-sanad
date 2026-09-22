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
npm create scaffold-hbar@latest my-sanad -- --template farouk-allani/template-hedera-sanad
```

The `--` is required. Without it npm keeps `--template` for itself and the CLI never sees it, which
silently gets you the default template instead of this one.

Yarn is the default. `--package-manager npm` also works; the scripts set environment variables
through `cross-env` so they run the same on Windows, macOS and Linux.

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

- **packages/hardhat** — `SanadSale.sol`, the interfaces it needs, a mock router for local tests,
  and the scripts that build and exercise a demo on testnet.
- **packages/nextjs** — the app. Arrives in the next milestone.

`SanadSale` holds the inventory and knows five things, all fixed at construction: the router, the
asset, the settlement token, where the issuer is paid, and the price per unit. It has no admin
switch to change them, so the terms a buyer sees cannot be edited underneath them.

## Try it on testnet

```bash
cp packages/hardhat/.env.example packages/hardhat/.env   # then set OPERATOR_KEY
yarn sanad:setup              # builds tokens, buyers, pool, contract and inventory
yarn sanad:test               # the acceptance suite, against real testnet
```

`OPERATOR_KEY` is the hex private key of an ECDSA account from the
[Hedera Portal](https://portal.hedera.com), used as-is so testnet costs you no password prompts.
It is refused for any network other than testnet. For anything holding real value, leave it empty
and use `yarn hardhat:account:import`, which keeps the key encrypted and asks for a password.

`sanad:setup` spends real testnet HBAR, most of it seeding the pool. It checkpoints every step that
costs something, so a run that fails partway resumes instead of paying twice.

## The purchase flow

A buyer cannot simply be sent a permissioned token. The order matters, and two of the three steps
are not the sale at all:

1. **Associate.** The buyer associates their account with the asset. Hedera requires this before an
   account can hold any balance of a token.
2. **Approve.** The issuer grants KYC, signed by the KYC key. This can only happen *after*
   association — `TokenGrantKyc` on an unassociated account resolves to
   `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`.
3. **Buy.** `buy(units, deadline)` with HBAR attached. Inside one transaction: SaucerSwap converts
   exactly enough HBAR to pay the issuer the settlement amount, the asset moves from inventory to
   the buyer, and the unused HBAR goes back. The network checks the token's rules during the second
   of those. If it refuses, the first is undone with it.

## What is guaranteed, and by whom

The distinction matters, because only one of these two lists survives a bug in the frontend.

**The ledger enforces these.** They hold against a direct contract call, a modified frontend, or a
buyer scripting against the contract:

- An unapproved or frozen buyer cannot receive the asset. Delivery is an HTS transfer, and HTS
  applies the token's KYC, freeze and pause rules itself.
- A paused token stops every transfer, including ours.
- Token supply cannot be inflated by this contract: it has no supply key.

**The sale contract enforces these.** They are only as good as the code, which is why the tests
assert balances rather than error names:

- Settlement is exact. The issuer receives the full price or the purchase reverts.
- Delivery failure reverts the payment. Every HTS response code is checked. D7.
- The buyer never spends more than the HBAR they attached, and gets the remainder back.
- A quote past its deadline is refused before the pool is touched.
- Only the issuer can withdraw inventory or recover HBAR.

## Key custody

The setup script gives each role its own key, because collapsing them hides what the issuer can
actually do. All six are written to a gitignored file for the demo; in production they belong in
separate custody.

| Key | Holder in the demo | What the holder can do, without asking the sale contract |
|---|---|---|
| Admin | Issuer | Change the token's other keys, including replacing all of the below |
| KYC | Compliance | Approve or un-approve any account, at any time |
| Freeze | Compliance | Freeze a holder, blocking transfers in and out |
| Pause | Compliance | Halt every transfer of the token at once |
| Wipe | Compliance | Burn units from a holder. This destroys them; it does not return them to the issuer |
| Supply | Issuer | Mint or burn supply. `SanadSale` deliberately does not hold this |
| Treasury | Issuer account | Receive settlement, and hold unsold supply |

The sale contract holds **none** of these. It is an ordinary account that happens to be associated
and approved, so the issuer can revoke its KYC and stop sales without touching the contract.

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

A run on Hedera testnet, 22 September 2026. Sale contract
[`0.0.10667622`](https://hashscan.io/testnet/contract/0.0.10667622), asset `SDFU`
[`0.0.10667614`](https://hashscan.io/testnet/token/0.0.10667614), settlement `sUSD`
[`0.0.10667613`](https://hashscan.io/testnet/token/0.0.10667613), at 10 sUSD per unit.

| What it shows | Result | Transaction |
|---|---|---|
| A purchase settles and delivers | `SUCCESS`, 226,422 gas | [`0x7efd…fbb7`](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0x7efd4a8982c94964a00eabebaa93ce89510d5a13418371404a9eb64f1268fbb7) |
| Buyer without KYC: delivery refused, swap undone | `DeliveryFailed(176)`, 188,431 gas | [`0xa41e…3c1b`](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xa41ec414917b837e59a51be7c8a98b812fd9189a7b15ecb990bf94312e633c1b) |
| Frozen buyer: same, after approval | `DeliveryFailed(165)` | [`0x7f17…0d96`](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0x7f174259efcf5a2b99583d91800782f663df92e1321bdf590c1835c3f4f10d96) |
| Budget below the price: pool refuses | `EXCESSIVE_INPUT_AMOUNT` | [`0xd4d1…72d8`](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xd4d1c90d93abff30235f32cd6a01d632f4959344996c054a5033064192ef72d8) |
| Expired quote: refused before the pool | `QuoteExpired` | [`0x6555…4e1b`](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0x6555d579b4ba06867d6d4e7b245843c75c4aca4e1e231ce29b4322f5eaba4e1b) |
| Issuer withdraws unsold inventory | `SUCCESS` | [`0xee97…68f5`](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xee9774325942019b2a5d8b9a8116fe0a3686cc2184118e6415986a8311f768f5) |

The second row is the one worth checking. The swap had already executed inside that call; HTS then
refused the delivery and the contract turned that response code into a full revert. Afterwards the
ledger shows the refused buyer holding **0** units with `kyc_status=REVOKED`, while the approved
buyer holds **2** and the issuer's sUSD is exactly 20 higher — two units at ten. Nothing settled
halfway.

Note that a rollback is **not** provable from the transaction's `token_transfers` being empty: HTS
movements inside a contract call are not recorded on the parent record, so that field is empty for
a successful purchase too. Balances and pool reserves are the evidence, which is what the
acceptance suite asserts.

## Troubleshooting

Symptoms and their causes, the Hedera ones especially, where the error text alone does not tell you
what to do next.

## Licence

MIT. See [LICENCE](LICENCE); the upstream Scaffold-HBAR and BuidlGuidl copyrights are kept alongside
Sanad's.
