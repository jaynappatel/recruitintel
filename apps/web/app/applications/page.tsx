import { ApplicationsPanel } from "@/components/applications/applications-panel";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Applications" };

export default function ApplicationsPage() {
  return (
    <>
      <PageHeader
        description="Your private application history. Every status change is saved, so you can always see how things progressed."
        eyebrow="Application workspace"
        title="Applications"
      />
      <ApplicationsPanel />
    </>
  );
}
