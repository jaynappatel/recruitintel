import { ResumesPanel } from "@/components/resumes/resumes-panel";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Resumes" };

export default function ResumesPage() {
  return (
    <>
      <PageHeader
        description="Upload a resume, review evidence, and use only confirmed evidence in deterministic job matching."
        eyebrow="Private evidence"
        title="Resumes"
      />
      <ResumesPanel />
    </>
  );
}
