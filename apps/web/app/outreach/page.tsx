import { OutreachPanel } from "@/components/outreach-panel";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Outreach" };
export default function OutreachPage() {
  return (
    <>
      <PageHeader
        description="RecruitIntel never sends anything for you. You write and review every draft, then copy and send it yourself."
        eyebrow="Consented outreach"
        title="Contacts and drafts"
      />
      <OutreachPanel />
    </>
  );
}
