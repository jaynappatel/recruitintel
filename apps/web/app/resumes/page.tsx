import { ResumesPanel } from "@/components/resumes/resumes-panel";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Resumes" };

export default function ResumesPage() {
  return (
    <>
      <PageHeader
        description="Upload a resume and review what we found. Only evidence you confirm is ever used to match you to jobs."
        eyebrow="Private evidence"
        title="Resumes"
      />
      <ResumesPanel />
    </>
  );
}
