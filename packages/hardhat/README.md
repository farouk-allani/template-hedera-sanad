# packages/hardhat

The sale contract, its tests, and the scripts that build and test a Sanad sale on Hedera testnet.
The [repository README](../../README.md) explains the pattern and maps the files; this page lists
the commands. Run them from the repository root.

| Command | What it does | HBAR |
|---|---|---|
| `yarn hardhat:compile` | Compiles the contracts | none |
| `yarn hardhat:test` | The local suite: the sale's terms, the quote, the deadline, the budget, access control on every privileged function, and the `receive()` guard, against a fork of testnet with a mock router | none, though it reads from the testnet RPC |
| `yarn hardhat:lint` | ESLint and Prettier | none |
| `yarn sanad:setup` | Creates the tokens, the compliance account, two buyers, the pool and the sale on testnet, then points the app at the new sale | about 200 |
| `yarn sanad:test` | The acceptance suite, against that sale: refused deliveries roll back in full, the budget and the deadline hold, and KYC calls from a browser wallet behave as the issuer console expects | about 3.3, most of it buying two units |
| `yarn hardhat:account:generate`, `yarn hardhat:account:import` | Creates or imports an encrypted key, for anything that holds real value | none |

The local suite proves that a failed delivery aborts the whole purchase, but not the reason a real
one fails: the forking plugin does not emulate the Token Service's KYC, freeze and pause rules, so a
delivery refused with 176, 165 or 265 only happens on testnet. That is what `sanad:test` is for.

`SanadSale` has no `deploy/` script, because its constructor reads the live SaucerSwap router, which
a local node does not have; `sanad:setup` deploys it. `yarn hardhat:chain` and
`yarn hardhat:deploy --network localhost` still work for Scaffold-HBAR's example contracts, and the
CI workflow uses them.

The key the Sanad scripts sign with is `OPERATOR_KEY` or the encrypted key, both described under
"Environment variables" in the repository README.
