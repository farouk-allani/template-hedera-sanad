"use client";

import Link from "next/link";
import type { NextPage } from "next";
import { BuildingLibraryIcon, ClockIcon, ShoppingCartIcon } from "@heroicons/react/24/outline";
import { SaleGate } from "~~/components/sanad/SaleGate";
import { SaleTerms } from "~~/components/sanad/SaleTerms";

const ROLES = [
  {
    href: "/buy",
    title: "Buy",
    text: "Associate, get approved, and buy with HBAR.",
    icon: ShoppingCartIcon,
  },
  {
    href: "/issuer",
    title: "Issuer console",
    text: "Approve buyers, take inventory back, see who controls the asset.",
    icon: BuildingLibraryIcon,
  },
  {
    href: "/activity",
    title: "Activity",
    text: "Every purchase and withdrawal, and where each buyer stands.",
    icon: ClockIcon,
  },
];

const Home: NextPage = () => (
  <div className="flex flex-col grow">
    <div className="hedera-gradient dark:bg-none dark:bg-hedera-charcoal w-full py-14 px-5">
      <div className="max-w-3xl mx-auto flex flex-col gap-3 text-white">
        <p className="m-0 text-sm font-medium tracking-widest uppercase text-white/70">Built on Hedera</p>
        <h1 className="m-0 text-4xl font-bold">Sanad</h1>
        <p className="m-0 text-lg text-white/90">
          Sell a permissioned asset for HBAR, in one transaction. The buyer pays HBAR, SaucerSwap converts exactly
          enough of it to pay the issuer in their settlement token, and the asset is delivered only if the token&apos;s
          own KYC, freeze and pause rules allow it.
        </p>
      </div>
    </div>

    <div className="w-full max-w-5xl mx-auto px-5 py-10 flex flex-col gap-8">
      <div className="grid gap-6 md:grid-cols-3">
        {ROLES.map(({ href, title, text, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="card bg-base-100 border border-base-300 hover:border-primary transition-colors"
          >
            <div className="card-body gap-2">
              <Icon className="h-7 w-7 text-primary" aria-hidden />
              <h2 className="card-title text-lg m-0">{title}</h2>
              <p className="m-0 text-sm opacity-70">{text}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem] items-start">
        <section className="card bg-base-100 border border-base-300">
          <div className="card-body gap-4">
            <h2 className="card-title text-base m-0">How one purchase works</h2>
            <ol className="m-0 pl-5 list-decimal flex flex-col gap-2 text-sm">
              <li>
                <span className="font-semibold">Associate.</span> The buyer&apos;s account opts in to holding the asset.
                Hedera requires this before any account can hold a token.
              </li>
              <li>
                <span className="font-semibold">Approve.</span> The issuer grants the account KYC, signed with the
                asset&apos;s KYC key. Deciding whom to approve happens outside the ledger.
              </li>
              <li>
                <span className="font-semibold">Buy.</span> In one transaction, SaucerSwap turns the buyer&apos;s HBAR
                into exactly the settlement owed, pays the issuer, and the sale delivers the asset. Unused HBAR goes
                back.
              </li>
            </ol>
            <p className="m-0 text-sm">
              The Hedera Token Service applies the asset&apos;s rules at the moment of delivery. If it refuses, because
              the buyer is not approved, is frozen, or the asset is paused, the swap and the payment are undone with it.
              A buyer never pays without being served, however the contract is called.
            </p>
          </div>
        </section>

        <SaleGate>{sale => <SaleTerms sale={sale} />}</SaleGate>
      </div>

      <p className="m-0 text-xs opacity-60">
        A template running on Hedera testnet. The asset and the settlement token are demo tokens created for it, and
        approving an account here verifies nobody&apos;s identity.
      </p>
    </div>
  </div>
);

export default Home;
