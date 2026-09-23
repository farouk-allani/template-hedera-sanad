import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, UserRejectedRequestError } from "viem";
import { INVALID_SIGNATURE, TOKEN_NOT_ASSOCIATED_TO_ACCOUNT } from "~~/utils/sanad/hts";

/** What happened, and what the person in front of the screen can do about it. */
export type Explanation = { title: string; action: string };

/** Why the network refused to move the asset to an account, by HTS response code. */
const REFUSALS: Record<number, Explanation> = {
  165: {
    title: "This account is frozen for the asset.",
    action: "Only the holder of the asset's freeze key can unfreeze it.",
  },
  176: {
    title: "This account is not approved to hold the asset.",
    action: "The issuer has to approve it first. Send them the account ID.",
  },
  178: {
    title: "The sale does not hold that many units.",
    action: "Ask for fewer units.",
  },
  184: {
    title: "This account is not associated with the asset.",
    action: "Associate it first: a Hedera account can only hold tokens it has associated with.",
  },
  265: {
    title: "The issuer has paused the asset.",
    action: "No transfer of it can happen until it is unpaused. Try again later.",
  },
};

const CONTRACT_ERRORS: Record<string, Explanation> = {
  QuoteExpired: {
    title: "The quote expired before the transaction reached the network.",
    action: "Get a fresh quote and try again.",
  },
  NotOwner: {
    title: "Only the sale's owner can do this.",
    action: "Connect the wallet that deployed the sale.",
  },
  InvalidAmount: {
    title: "The number of units must be a whole number above zero.",
    action: "Change the amount.",
  },
  ZeroAddress: {
    title: "The recipient is missing.",
    action: "Enter the account that should receive the units.",
  },
  RefundFailed: {
    title: "The unused HBAR could not be returned to your account, so the purchase was cancelled.",
    action: "Check that your account accepts incoming HBAR without requiring its own signature.",
  },
};

const PRICE_MOVED: Explanation = {
  title: "The pool now wants more HBAR than your maximum.",
  action: "Raise your price tolerance, or wait and buy at the new price.",
};

/** Falls back to the bare response code for a refusal the sale does not expect. */
export const explainRefusal = (code: number): Explanation =>
  REFUSALS[code] ?? {
    title: `The network refused the request with response code ${code}.`,
    action: "Look the transaction up on HashScan for the details.",
  };

/** Explains the response code a KYC call to the system contract returned; it does not revert. */
export function explainKycResponse(code: number): Explanation {
  if (code === INVALID_SIGNATURE) {
    return {
      title: "This wallet does not hold the asset's KYC key, so the network ignored the request.",
      action: "Connect the compliance officer's wallet and try again.",
    };
  }
  if (code === TOKEN_NOT_ASSOCIATED_TO_ACCOUNT) {
    return {
      title: "This account is not associated with the asset, so it cannot be approved yet.",
      action: "The buyer has to associate first.",
    };
  }
  return explainRefusal(code);
}

/** Turns a failed simulation, a wallet refusal or a revert into what happened and what to do. */
export function explainError(error: unknown): Explanation {
  if (!(error instanceof BaseError)) {
    return { title: "Something went wrong.", action: error instanceof Error ? error.message : String(error) };
  }
  if (error.walk(e => e instanceof UserRejectedRequestError)) {
    return { title: "You declined the request in your wallet.", action: "Nothing was sent." };
  }
  if (error.walk(e => e instanceof InsufficientFundsError)) {
    return {
      title: "Your HBAR balance does not cover this transaction and its fee.",
      action: "Top up from the Hedera Portal faucet.",
    };
  }
  const revert = error.walk(e => e instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) {
    const { errorName, args } = revert.data ?? {};
    if (errorName === "DeliveryFailed" || errorName === "WithdrawalFailed") return explainRefusal(Number(args?.[0]));
    if (errorName && CONTRACT_ERRORS[errorName]) return CONTRACT_ERRORS[errorName];
    if (revert.reason?.includes("EXCESSIVE_INPUT_AMOUNT")) return PRICE_MOVED;
  }
  return { title: "The transaction could not be completed.", action: error.shortMessage };
}
