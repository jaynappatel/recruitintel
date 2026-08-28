import { ApplicationsPanel } from "@/components/applications/applications-panel";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Applications" };

export default function ApplicationsPage() {
  return (
    <>
      <PageHeader
        description="Your private, append-only application history. Status updates create durable lifecycle events."
        eyebrow="Application workspace"
        title="Applications"
      />
      <ApplicationsPanel />
    </>
  );
}
