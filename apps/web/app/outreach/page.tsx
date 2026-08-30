import { OutreachPanel } from "@/components/outreach-panel";

export const metadata = { title: "Outreach" };
export default function OutreachPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="mb-6">
        <p className="eyebrow">Consented outreach</p>
        <h1 className="font-serif text-4xl font-semibold">Contacts and reviewed drafts</h1>
        <p className="text-[var(--muted)]">
          Use only public evidence or contacts you provide. RecruitIntel never guesses addresses or
          sends mail.
        </p>
      </div>
      <OutreachPanel />
    </div>
  );
}
