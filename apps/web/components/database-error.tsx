import { NoticeBanner } from "@/components/ui/notice-banner";

export function DatabaseError({ message }: { message?: string }) {
  if (message) console.error("[DatabaseError]", message);
  return (
    <NoticeBanner title="We can't reach the database right now" tone="warning">
      Try refreshing in a moment. If this keeps happening, contact support.
    </NoticeBanner>
  );
}
