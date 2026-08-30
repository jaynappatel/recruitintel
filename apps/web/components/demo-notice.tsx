import { NoticeBanner } from "@/components/ui/notice-banner";

export function DemoNotice() {
  return (
    <NoticeBanner className="mb-6" compact tone="info">
      Seed jobs are synthetic examples and are never presented as live openings. Live postings are
      collected separately and clearly sourced.
    </NoticeBanner>
  );
}
