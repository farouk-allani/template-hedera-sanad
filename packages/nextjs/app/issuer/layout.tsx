import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Issuer console",
  description: "Approve buyers, withdraw unsold inventory, and see who controls the asset.",
});

const IssuerLayout = ({ children }: { children: React.ReactNode }) => children;

export default IssuerLayout;
