import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Activity",
  description: "The sale's history from the Hedera mirror node, and where every buyer stands now.",
});

const ActivityLayout = ({ children }: { children: React.ReactNode }) => children;

export default ActivityLayout;
