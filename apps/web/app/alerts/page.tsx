import { PageHeader } from "@/components/page-header";
import { AlertsPanel } from "@/components/personalization/alerts-panel";

export const metadata = { title: "Alerts" };

export default function AlertsPage() {
  return (
    <>
      <PageHeader
        description="Meaningful updates about the opportunities and companies you're tracking — we keep the noise down."
        eyebrow="In-app only"
        title="Alerts"
      />
      <AlertsPanel />
    </>
  );
}
