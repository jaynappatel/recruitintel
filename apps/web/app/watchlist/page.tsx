import { PageHeader } from "@/components/page-header";
import { WatchlistPanel } from "@/components/personalization/watchlist-panel";

export const metadata = { title: "Watchlist" };

export default function WatchlistPage() {
  return (
    <>
      <PageHeader
        description="Your private company, opportunity, recruiter, and school intent—history included."
        eyebrow="Private intent"
        title="Watchlist"
      />
      <WatchlistPanel />
    </>
  );
}
