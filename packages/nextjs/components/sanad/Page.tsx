import type { ReactNode } from "react";

export const Page = ({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) => (
  <div className="w-full max-w-5xl mx-auto px-5 py-10 flex flex-col gap-6">
    <header className="flex flex-col gap-2">
      <h1 className="text-3xl font-bold m-0">{title}</h1>
      <p className="text-base-content/70 m-0 max-w-3xl">{intro}</p>
    </header>
    {children}
  </div>
);
