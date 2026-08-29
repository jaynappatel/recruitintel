import { DailyWorkflowPanel } from "@/components/daily-workflow-panel";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default function TodayPage() {
  return (
    <>
      <PageHeader
        description="A deterministic queue composed from your alerts, application actions, and calendar work."
        eyebrow="Daily workflow"
        title="What should I do today?"
      />
      <DailyWorkflowPanel />
    </>
  );
}
