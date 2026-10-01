import { MakerCockpit } from "@/components/maker/MakerCockpit";

export const metadata = {
  title: "Maker | Setryn Terminal",
  description: "Quote the public book from your wallet: working quotes, fills, inventory, collateral and private requests.",
};

export default function MakerPage() {
  return <MakerCockpit />;
}
