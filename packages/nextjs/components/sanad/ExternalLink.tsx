import type { ReactNode } from "react";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";

export const ExternalLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1">
    {children}
    <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 opacity-60" aria-hidden />
  </a>
);
