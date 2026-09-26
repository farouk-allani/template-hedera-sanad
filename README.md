# Sanad

Sell a **permissioned** asset on Hedera for HBAR, in a single transaction.

The buyer pays HBAR. SaucerSwap V1 converts exactly enough of it into the issuer's settlement
token and pays the issuer. The asset is then delivered from the sale contract's inventory, and the
Hedera Token Service decides whether that delivery is allowed using the token's own KYC, freeze and
pause rules. If the network refuses, the swap and the payment are undone with it. There is no state
in which the buyer has paid and not been served.

_Sanad_ (سند) is Arabic for a deed or title: the document that says a thing is yours.

> **Status.** Built in the open for the Hedera Scaffold-HBAR Template Bounty. The sale contract, its
> testnet acceptance suite and the app's screens are in place and run against a live testnet
> deployment. Three sections are still short and are being written next: environment variables,
> customising it for your asset, and troubleshooting.

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

```bash
cd my-sanad
yarn next:start               # then open http://localhost:3000
```

The app opens on a live demo sale on Hedera testnet, so there is something real to look at before
you deploy anything. Connect a wallet on Hedera Testnet to associate and see the approval step;
finishing a purchase needs the sale's compliance wallet to approve you, which is the point. To run
the whole flow yourself, deploy your own sale: see [Try it on testnet](#try-it-on-testnet).

Yarn is the default. `--package-manager npm` also works; the scripts set environment variables
through `cross-env` so they run the same on Windows, macOS and Linux.

## Prerequisites

- [Node.js](https://nodejs.org/) 20.18.3 or later
- Yarn 3 via Corepack (`corepack enable`), or npm 10+ if you scaffold with `--package-manager npm`
- Git with `user.name` and `user.email` set; the scaffold CLI refuses to run without them
- For your own sale on testnet: an **ECDSA** account from the
  [Hedera Portal](https://portal.hedera.com). It starts with 1,000 test HBAR and can draw up to
  1,000 a day, and setup spends about 200. The anonymous [faucet](https://portal.hedera.com/faucet)
  gives 100, which is plenty for a buyer's wallet but not enough for setup.

## Environment variables

Each package reads its own `.env`, next to its `package.json`. Copy the `.env.example` beside it and
fill that in; a `.env` at the repository root is not read by anything. The app needs none of these
to run against the demo sale. Running your own sale needs one: `OPERATOR_KEY`, or an encrypted key.

**`packages/hardhat/.env`**

| Variable | Default | Read by | What it does |
|---|---|---|---|
| `OPERATOR_KEY` | none | `sanad:setup`, `sanad:test` | The issuer's ECDSA testnet key, hex or DER. Refused for any network other than testnet. |
| `DEPLOYER_PRIVATE_KEY_ENCRYPTED` | none | `sanad:*`, `hardhat:deploy`, `hardhat:account` | Written by `yarn hardhat:account:generate` or `yarn hardhat:account:import`, and unlocked with a password. Use it for any key that holds real value. |
| `HEDERA_RPC_URL` | `https://testnet.hashio.io/api` | `hardhat:test`, `hardhat:chain` | The endpoint the local test network forks from. It does not change where anything is deployed: the `hederaTestnet` and `hederaMainnet` networks have their own URLs in `hardhat.config.ts`. |
| `HEDERA_MIRROR_TESTNET_URL` | `https://testnet.mirrornode.hedera.com` | `sanad:setup`, `sanad:test` | The mirror node the scripts read accounts, tokens and results from. |
| `SAUCERSWAP_V1_ROUTER_ID` | `0.0.19264` | `sanad:setup` | The SaucerSwap V1 router the sale swaps through. Setup records it with the deployment. |

**`packages/nextjs/.env`**

| Variable | Default | Read by | What it does |
|---|---|---|---|
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | the scaffold's shared ID | the wallet connectors | Fine on your own machine. Create your own at [cloud.reown.com](https://cloud.reown.com) before you put the app anywhere public. |
| `NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL` | `https://testnet.hashio.io/api` | contract reads and simulations | The JSON-RPC endpoint the app reads testnet through. Transactions go through the wallet's own RPC. |
| `HEDERA_MIRROR_TESTNET_URL` | `https://testnet.mirrornode.hedera.com` | `/api/hedera/account` | The server route that shows a connected wallet's account ID. Sanad's screens call the mirror node from the browser, through `MIRROR_NODE_URL` in `utils/sanad/mirror.ts`. |

The scripts set `__RUNTIME_DEPLOYER_PRIVATE_KEY`, `HEDERA_FORKING` and `REPORT_GAS` themselves; do not
set them by hand. Upstream's hosting helpers also read `NEXT_PUBLIC_IGNORE_BUILD_ERROR`,
`NEXT_PUBLIC_IPFS_BUILD` and `VERCEL_PROJECT_PRODUCTION_URL`, which Sanad does not need.

## Architecture

- **packages/hardhat** — `SanadSale.sol`, the interfaces it needs, a mock router for local tests,
  and the scripts that build and exercise a demo on testnet.
- **packages/nextjs** — the app: `/buy` for buyers, `/issuer` for the issuer's two authorities,
  `/activity` for the record, and upstream's `/debug` for calling the contract directly. The
  contract supplies the sale's fixed terms and the live quote. Everything the token itself decides
  (who is approved or frozen, whether it is paused, who holds which key, who has associated) is read
  from the Hedera mirror node, the only place it can be read.

`SanadSale` holds the inventory and knows five things, all fixed at construction: the router, the
asset, the settlement token, where the issuer is paid, and the price per unit. It has no admin
switch to change them, so the terms a buyer sees cannot be edited underneath them.

## Try it on testnet

```bash
cp packages/hardhat/.env.example packages/hardhat/.env   # then set OPERATOR_KEY
yarn sanad:setup              # tokens, compliance account, buyers, pool, contract, inventory
yarn sanad:test               # the acceptance suite, against real testnet
```

`OPERATOR_KEY` is the private key of an ECDSA account from the
[Hedera Portal](https://portal.hedera.com), hex or DER-encoded, whichever the Portal shows you. It
is used as-is so testnet costs you no password prompts.
It is refused for any network other than testnet. For anything holding real value, leave it empty
and use `yarn hardhat:account:import`, which keeps the key encrypted and asks for a password.

The app ships pointed at a live demo sale on testnet (the one under
[Testnet evidence](#testnet-evidence)), so it works before you deploy anything. `sanad:setup` deploys
your own and points the app at it instead, by rewriting two files:
`packages/nextjs/contracts/deployedContracts.ts` and
`packages/hardhat/deployments/hederaTestnet/SanadSale.json`. Commit both, and your fork ships
pointed at your sale. The second is committed on purpose: the frontend's contract list is rebuilt
from `deployments/` on every deploy, so a sale whose record is not there disappears from the app.

`sanad:setup` spends real testnet HBAR, most of it seeding the pool. It checkpoints every step that
costs something, so a run that fails partway resumes instead of paying twice.

The demo's keys, one per token role plus the two buyers', are written to
`packages/hardhat/.sanad/testnet.keys.json`, which is gitignored. Setup also creates an account
controlled by the KYC key, because approving a buyer means signing with that key. To approve buyers
from the app, import the `kyc` key from that file into a browser wallet. It is a throwaway testnet
key; in production the KYC key belongs to whoever actually carries out compliance, on their own
device.

What it costs, measured on testnet in September 2026. Hedera prices fees in US dollars and charges
the HBAR equivalent at the current exchange rate, so these move with the rate.

| Action | Cost |
|---|---|
| `sanad:setup` | About 200 HBAR: the SaucerSwap pool-creation fee (25.95 HBAR on 22 September), 100 HBAR of pool liquidity, 30 HBAR for each of the two demo buyers, 5 for the compliance account, and gas |
| A buyer associating with the asset, once | 0.79 HBAR |
| Approving or revoking a buyer | 0.04 HBAR |
| A purchase | 0.21 HBAR in fees, plus the HBAR the pool takes for the settlement amount |

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

In the app, `/buy` walks a buyer through the three steps in that order and shows where they stand.
Association needs no Hedera SDK and no special wallet: every HTS token answers `associate()` at its
own address ([HIP-719](https://hips.hedera.com/hip/hip-719)), so any EVM wallet can send it. The
page quotes live from the pool, sets the maximum spend to the quote plus a tolerance the buyer picks
(0.5, 1 or 3 per cent), and sets the deadline two minutes after Buy is pressed; the contract enforces
both. Before asking the wallet to sign, it simulates the purchase as the buyer. Every refusal the
network would make, whether not approved, frozen, paused or the price moved past the maximum, shows
up in that simulation, so the page explains it before anything is paid.

`/activity` lists what the sale contract recorded, every purchase and every withdrawal, each linked
to its transaction on HashScan, and where every buyer stands now. Approvals and revocations have no
history there. They are token operations rather than sale events, and the mirror node cannot list
them by token, because its record of each one names the account, not the asset. A history of them
would need a log of its own, such as a Hedera Consensus Service topic written alongside each change.

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
- Delivery failure reverts the payment. Every HTS response code is checked.
- The buyer never spends more than the HBAR they attached, and gets the remainder back.
- A quote past its deadline is refused before the pool is touched.
- Only the issuer can withdraw inventory or recover HBAR.

## Key custody

The setup script gives each role its own key, because collapsing them hides what the issuer can
actually do. All six are written to a gitignored file for the demo; in production they belong in
separate custody.

| Key | Who should hold it | What the holder can do, without asking the sale contract |
|---|---|---|
| Admin | Issuer | Change the token's other keys, including replacing all of the below |
| KYC | Compliance. In the demo, the account setup creates for it, so a browser wallet can sign | Approve or un-approve any account, at any time |
| Freeze | Compliance | Freeze a holder, blocking transfers in and out |
| Pause | Compliance | Halt every transfer of the token at once |
| Wipe | Compliance | Burn units from a holder. This destroys them; it does not return them to the issuer |
| Supply | Issuer | Mint or burn supply. `SanadSale` deliberately does not hold this |
| Treasury | Issuer account | Receive settlement, and hold unsold supply |

The sale contract holds **none** of these. It is an ordinary account that happens to be associated
and approved, so the issuer can revoke its KYC and stop sales without touching the contract.

The issuer console, `/issuer`, reads these keys from the ledger and names the account holding each
one where it can: the ledger links a key to an account only when an account uses it as its own key.
Before offering anything, the console works out which of two authorities the connected wallet has.
Approving a buyer takes the KYC key; withdrawing inventory takes the sale's owner, the account that
deployed it. They are usually different wallets, and the console names the one to connect.

Buyers are found through association, the one on-chain step a buyer takes before approval, which
Hedera requires anyway. The console lists every account associated with the asset, apart from the
treasury and the sale itself, with each one's standing. Anyone can associate, so the list shows who
asked, not who has been checked: checking who a buyer is happens outside the ledger, and approving
records the decision on it. A buyer can also send their account ID, or a link that opens the console
on their account.

## Why SaucerSwap, and why not just pay in the stablecoin

Because the two sides want different things. The buyer holds HBAR and does not want to go and
acquire a stablecoin first; the issuer needs to be paid in a stable unit and does not want price
risk between quote and settlement. Doing the conversion inside the purchase means the buyer spends
HBAR, the issuer receives exactly the settlement amount, and neither has to trust the other to
convert. If your buyers already hold your settlement token, you do not need Sanad's swap leg, and
the README will say so plainly rather than sell you the detour.

## Hedera traps this template handles

Hedera's EVM differs from Ethereum's in ways that cost real money to discover. Each of these was hit
or checked while building Sanad, and each is handled in the code.

- **The Hedera Token Service reports a refusal as a return value, not a revert.** A contract that
  ignores the code keeps the buyer's HBAR and delivers nothing. `SanadSale` checks every code and
  reverts with it, as `DeliveryFailed(code)`.
- **A KYC change sent from the wrong wallet "succeeds".** `grantTokenKyc` sent to `0x167` by a wallet
  without the KYC key gives a successful transaction that returned 7, `INVALID_SIGNATURE`, and a
  simulation reports success too (see the evidence table). The console checks the wallet's key
  before offering an approval and confirms every change on the mirror node.
- **KYC can only be granted to an associated account.** So association comes first even for an
  account with unlimited automatic associations, which only associates when a token arrives.
- **An unassociated buyer is refused with 176, not 184,** when the account allows unlimited automatic
  associations, the default for accounts created by sending HBAR to an EVM address
  ([HIP-904](https://hips.hedera.com/hip/hip-904)). The app reads association from the mirror node
  instead of inferring it from the error code.
- **An account with an ECDSA alias must be addressed by its alias.** HTS refuses its long-zero
  address with `INVALID_ALIAS_KEY` (282). The issuer's treasury and every KYC call use the alias.
- **HBAR has two decimal systems.** Inside a contract, `msg.value` and balances are tinybars (8
  decimals); wallets and the JSON-RPC relay use weibars (18). Some Hedera documentation pages say a
  contract sees 18; the purchases in the evidence table settle to the tinybar with 8. The app
  converts in one place, `WEIBARS_PER_TINYBAR`.
- **SaucerSwap has two WHBAR addresses.** `WHBAR()` is the wrapper contract and `whbar()` the HTS
  token. A swap path must start with the token, or the router reverts with `INVALID_PATH`.
- **The router refunds its caller, not the buyer.** In an exact-output swap made by a contract, the
  unused HBAR comes back to the contract, so `SanadSale` forwards it in the same transaction.
- **`receive()` does not run for native HBAR transfers,** so a contract's balance can change without
  its code running. `sweepHbar` exists for HBAR that arrives that way.
- **The mirror node trails consensus by a few seconds.** A read straight after a transaction can be
  stale, so the app waits for the mirror node to show a change before reporting it.
- **A contract wiped by a testnet reset looked deployed.** The scaffold's contract check compared
  `getCode()` with `"0x"`, but viem returns `undefined` for an address without code, so every screen
  waited forever. Fixed here; the app now says there is no sale at that address.
- **Creating a SaucerSwap pool takes about 6.8 million gas.** Below that, `addLiquidityETHNewPool`
  fails inside an association. Setup gives it 9 million.

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

Runs of the acceptance suite on Hedera testnet, 22 and 23 September 2026, against one deployment.
Sale contract [`0.0.10667622`](https://hashscan.io/testnet/contract/0.0.10667622), asset `SDFU`
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
| Paused asset: delivery refused, swap undone | `DeliveryFailed(265)` | [`0xad79…2d40`](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xad79d104d759095377c2ac79fea3e3465376c674c63eff1aa8678dda4f022d40) |
| Compliance wallet approves a buyer from a plain EVM wallet | `SUCCESS`, returned 22 | [`0x9251…2a3e`](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0x925168f2f9a3564e6e4ddc24694e8697137d3d1c53c0ad9f9779a4f837692a3e) |
| … and revokes the approval | `SUCCESS`, returned 22 | [`0xd11f…6d8f`](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xd11ff3030b5a4d1c75e0da9a0c92a1dd4018525d9e17ffe77a40092df7ff6d8f) |
| A wallet without the KYC key tries to approve itself | `SUCCESS`, returned **7**, nothing changed | [`0xcd66…df6a`](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xcd664f18de80e360c97064a1333f5a433ae175939f92037f0ee34e356714df6a) |

The second row is the one worth checking. The swap had already executed inside that call; HTS then
refused the delivery and the contract turned that response code into a full revert. Right after that
first run, the ledger showed the refused buyer holding **0** units with `kyc_status=REVOKED`, while
the approved buyer held **2** and the issuer's sUSD was exactly 20 higher: two units at ten. Nothing
settled halfway.

Note that a rollback is **not** provable from the transaction's `token_transfers` being empty: HTS
movements inside a contract call are not recorded on the parent record, so that field is empty for
a successful purchase too. Balances and pool reserves are the evidence, which is what the
acceptance suite asserts.

The last row is the one to remember when writing a frontend. The Ethereum transaction succeeds, and
the refusal (`INVALID_SIGNATURE`, 7) exists only in the value the call returned. Anything that trusts
the receipt reports an approval that never happened. Simulation does not help either: it returns
success for that call whoever sends it. So the issuer console checks that the connected wallet's
key is the KYC key before it offers an approval, and after sending one it reads the returned code
back from the mirror node and waits until the buyer's status has actually changed there.

## Troubleshooting

Symptoms and their causes, the Hedera ones especially, where the error text alone does not tell you
what to do next.

## Licence

MIT. See [LICENCE](LICENCE); the upstream Scaffold-HBAR and BuidlGuidl copyrights are kept alongside
Sanad's.
