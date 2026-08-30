import { InterviewPrepPanel } from "@/components/interview-prep-panel";
import { PageHeader } from "@/components/page-header";
export const dynamic = "force-dynamic";
export default async function InterviewPreparePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <PageHeader
        eyebrow="Interview preparation"
        title="Prepare with evidence"
        description="A private prep plan built around your scheduled interview. Publicly shared interview questions appear here once verified."
      />
      <InterviewPrepPanel interviewId={id} />
    </>
  );
}
