"use client";

import { type ReactNode, useState } from "react";
import Link from "next/link";
import { hederaPortalFaucetUrl } from "@scaffold-hbar-ui/components";
import { useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { CheckIcon, DocumentDuplicateIcon } from "@heroicons/react/24/outline";
import { PurchaseForm } from "~~/app/buy/_components/PurchaseForm";
import { ErrorNotice } from "~~/components/sanad/ErrorNotice";
import { ExternalLink } from "~~/components/sanad/ExternalLink";
import { useHtsCalls } from "~~/hooks/sanad/useHtsCalls";
import { useMirror } from "~~/hooks/sanad/useMirror";
import type { Sale } from "~~/hooks/sanad/useSale";
import { useCopyToClipboard } from "~~/hooks/scaffold-hbar";
import { type Explanation, explainError, explainRefusal } from "~~/utils/sanad/errors";
import { shortHex } from "~~/utils/sanad/format";
import { SUCCESS, TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT } from "~~/utils/sanad/hts";
import {
  MirrorAccount,
  TokenRelationship,
  accountRoute,
  relationshipRoute,
  waitForMirror,
} from "~~/utils/sanad/mirror";

const ACCOUNT_FROZEN_FOR_TOKEN = 165;
const TOKEN_IS_PAUSED = 265;

type Holding = { tokens: TokenRelationship[] };

/**
 * The buyer's path, in the only order Hedera allows: associate, then be approved (KYC can only be
 * granted to an associated account), then buy.
 */
export const BuyFlow = ({ sale }: { sale: Sale }) => {
  const { address } = useAccount();
  const account = useMirror<MirrorAccount>(address && accountRoute(address));
  const holding = useMirror<Holding>(address && relationshipRoute(address, sale.asset.id), 10_000);

  const symbol = sale.asset.token?.symbol ?? "the asset";
  const accountId = account.data?.account;
  const relationship = holding.data?.tokens[0];
  const associated = relationship !== undefined;
  const approved = relationship?.kyc_status === "GRANTED";

  const association = !address ? (
    <p className="m-0">Connect a wallet on Hedera Testnet to start. You will need some testnet HBAR from the faucet.</p>
  ) : account.isPending || holding.isPending ? (
    <span className="loading loading-spinner loading-md" />
  ) : !accountId ? (
    <p className="m-0">
      {shortHex(address)} has no Hedera account yet. One is created the first time HBAR is sent to the address, for
      example from the <ExternalLink href={hederaPortalFaucetUrl(address)}>Hedera Portal faucet</ExternalLink>. Come
      back once it has arrived.
    </p>
  ) : associated ? (
    <p className="m-0">
      Account {accountId} can hold {symbol}.
    </p>
  ) : (
    <Associate sale={sale} buyer={address} />
  );

  return (
    <div className="flex flex-col gap-4">
      <Step number={1} title={`Associate your account with ${symbol}`} done={associated} active={!associated}>
        {association}
      </Step>

      <Step number={2} title="Get approved by the issuer" done={approved} active={associated && !approved}>
        {approved ? (
          <p className="m-0">The issuer has approved {accountId}.</p>
        ) : associated && accountId ? (
          <AwaitingApproval accountId={accountId} />
        ) : (
          <p className="m-0">After association: the network can only approve an account that is associated.</p>
        )}
      </Step>

      <Step number={3} title={`Buy ${symbol}`} done={false} active={approved}>
        {!address || !approved ? (
          <p className="m-0">Once the issuer has approved your account.</p>
        ) : relationship.freeze_status === "FROZEN" ? (
          <ErrorNotice explanation={explainRefusal(ACCOUNT_FROZEN_FOR_TOKEN)} />
        ) : sale.asset.token?.pause_status === "PAUSED" ? (
          <ErrorNotice explanation={explainRefusal(TOKEN_IS_PAUSED)} />
        ) : (
          <PurchaseForm sale={sale} buyer={address} />
        )}
      </Step>
    </div>
  );
};

const Step = ({
  number,
  title,
  done,
  active,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  active: boolean;
  children: ReactNode;
}) => (
  <section
    className={`card bg-base-100 border ${active ? "border-primary" : "border-base-300"} ${done || active ? "" : "opacity-60"}`}
  >
    <div className="card-body gap-3">
      <h2 className="card-title text-base m-0">
        <span className={`badge ${done ? "badge-success" : active ? "badge-primary" : "badge-ghost"}`}>
          {done ? <CheckIcon className="h-3.5 w-3.5" aria-label="Done" /> : number}
        </span>
        {title}
      </h2>
      {children}
    </div>
  </section>
);

const Associate = ({ sale, buyer }: { sale: Sale; buyer: Address }) => {
  const { associate } = useHtsCalls();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Explanation>();

  const run = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      const { code, result } = await associate(sale.asset.address);
      if (code !== SUCCESS && code !== TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT) {
        setProblem(
          code === undefined
            ? { title: `The transaction failed: ${result}.`, action: "Try again. If it keeps failing, check HashScan." }
            : explainRefusal(code),
        );
        return;
      }
      const route = relationshipRoute(buyer, sale.asset.id);
      await waitForMirror<Holding>(route, data => Boolean(data?.tokens[0]));
      await queryClient.invalidateQueries({ queryKey: ["mirror", route] });
    } catch (error) {
      setProblem(explainError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="m-0">
        A Hedera account can only hold a token it has associated with. It is a one-time transaction from your wallet,
        about 0.8 HBAR on testnet.
      </p>
      {problem && <ErrorNotice explanation={problem} />}
      <button type="button" className="btn btn-primary w-fit" disabled={busy} onClick={run}>
        {busy && <span className="loading loading-spinner loading-sm" />}
        Associate
      </button>
    </>
  );
};

const AwaitingApproval = ({ accountId }: { accountId: string }) => {
  const { copyToClipboard, isCopiedToClipboard } = useCopyToClipboard();
  return (
    <>
      <p className="m-0">
        Approval is the issuer&apos;s decision, made however they check who a buyer is; the ledger only records it. Send
        them your account ID:
      </p>
      <div className="flex items-center gap-2">
        <code className="text-lg">{accountId}</code>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => copyToClipboard(accountId)}
          aria-label="Copy the account ID"
        >
          {isCopiedToClipboard ? <CheckIcon className="h-4 w-4" /> : <DocumentDuplicateIcon className="h-4 w-4" />}
        </button>
      </div>
      <p className="m-0 text-sm opacity-70">
        Or send them this page of the{" "}
        <Link className="link" href={`/issuer?account=${accountId}`}>
          issuer console
        </Link>
        , which opens on your account. This page checks for the approval every ten seconds.
      </p>
    </>
  );
};
