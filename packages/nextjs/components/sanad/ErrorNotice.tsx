import { ExclamationCircleIcon } from "@heroicons/react/24/outline";
import type { Explanation } from "~~/utils/sanad/errors";

/** A failure stated as what happened and what to do next, with an optional note on what it cost. */
export const ErrorNotice = ({ explanation, note }: { explanation: Explanation; note?: string }) => (
  <div role="alert" className="alert alert-error alert-soft items-start">
    <ExclamationCircleIcon className="h-5 w-5 shrink-0" />
    <div className="flex flex-col gap-1">
      <p className="font-semibold m-0">{explanation.title}</p>
      <p className="m-0 text-sm text-base-content">
        {explanation.action}
        {note && ` ${note}`}
      </p>
    </div>
  </div>
);
