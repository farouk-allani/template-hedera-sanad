import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Buy",
  description: "Buy the permissioned asset with HBAR: associate, get approved, buy.",
});

const BuyLayout = ({ children }: { children: React.ReactNode }) => children;

export default BuyLayout;
