import { PageHeader } from "@/components/page-header";
import { WatchlistPanel } from "@/components/personalization/watchlist-panel";

export const metadata = { title: "Watchlist" };

export default function WatchlistPage() {
  return (
    <>
      <PageHeader
        description="Everything you're watching — companies, opportunities, recruiters, and schools — with your history for each."
        eyebrow="Private intent"
        title="Watchlist"
      />
      <WatchlistPanel />
    </>
  );
}
