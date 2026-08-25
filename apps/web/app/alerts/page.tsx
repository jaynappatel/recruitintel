import { PageHeader } from "@/components/page-header";
import { AlertsPanel } from "@/components/personalization/alerts-panel";

export const metadata = { title: "Alerts" };

export default function AlertsPage() {
  return (
    <>
      <PageHeader
        description="Conservative, meaningful updates from canonical opportunities and existing recruiting intelligence."
        eyebrow="In-app only"
        title="Alerts"
      />
      <AlertsPanel />
    </>
  );
}
