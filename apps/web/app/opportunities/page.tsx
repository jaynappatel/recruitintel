import { PageHeader } from "@/components/page-header";
import { RecommendationsPanel } from "@/components/personalization/recommendations-panel";

export const metadata = { title: "Recommendations" };

export default function OpportunitiesPage() {
  return (
    <>
      <PageHeader
        description="Canonical opportunities ranked from your explicit preferences. Scores prioritize review; they are not hiring probabilities."
        eyebrow="Private opportunity queue"
        title="Recommendations"
      />
      <RecommendationsPanel />
    </>
  );
}
