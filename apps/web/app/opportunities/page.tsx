import { PageHeader } from "@/components/page-header";
import { RecommendationsPanel } from "@/components/personalization/recommendations-panel";

export const metadata = { title: "Recommendations" };

export default function OpportunitiesPage() {
  return (
    <>
      <PageHeader
        description="Ranked using the preferences you set. These scores help you prioritize review — they're not a prediction of who gets hired."
        eyebrow="Private opportunity queue"
        title="Recommendations"
      />
      <RecommendationsPanel />
    </>
  );
}
