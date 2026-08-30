import { DailyWorkflowPanel } from "@/components/daily-workflow-panel";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default function TodayPage() {
  return (
    <>
      <PageHeader
        description="Everything due today, pulled from your alerts, application follow-ups, and calendar."
        eyebrow="Daily workflow"
        title="What should I do today?"
      />
      <DailyWorkflowPanel />
    </>
  );
}
