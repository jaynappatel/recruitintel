import { GoogleCalendarCard } from "@/components/settings/google-calendar-card";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Settings" };

function SettingsSection({
  eyebrow,
  title,
  description,
  children,
  id,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section className="surface p-6" id={id}>
      <div className="mb-5">
        <div className="eyebrow mb-1">{eyebrow}</div>
        <h2 className="m-0 font-serif text-xl font-semibold">{title}</h2>
        <p className="mt-1.5 mb-0 max-w-xl text-sm text-[var(--muted)]">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Field({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">
      {label}
      <input
        className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
        placeholder={placeholder}
        type="text"
      />
    </label>
  );
}

function ToggleRow({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-[var(--muted)]">{description}</div>
      </div>
      <span className="relative h-6 w-10 shrink-0 rounded-full bg-[var(--panel)]">
        <span className="absolute top-0.5 left-[calc(100%-1.375rem)] size-5 rounded-full bg-white shadow" />
      </span>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        description="Preferences that shape which signals, jobs, and recruiting windows RecruitIntel surfaces for you."
        eyebrow="Account"
        title="Settings"
      />

      <div className="flex flex-col gap-6">
        <SettingsSection
          description="Used to prioritize jobs, deadlines, and recruiting windows relevant to you."
          eyebrow="Profile"
          title="Recruiting preferences"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Graduation year" placeholder="2027" />
            <Field label="School" placeholder="e.g. University of Michigan" />
            <Field label="Target roles" placeholder="Software Engineering, Data Science" />
            <Field label="Target locations" placeholder="Remote, San Francisco, New York" />
          </div>
          <div className="mt-4 flex gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input className="size-4 accent-[var(--panel)]" defaultChecked type="checkbox" />
              Internships
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input className="size-4 accent-[var(--panel)]" type="checkbox" />
              New grad roles
            </label>
          </div>
        </SettingsSection>

        <SettingsSection
          description="Choose what RecruitIntel should notify you about, and how."
          eyebrow="Alerts"
          title="Notification preferences"
        >
          <div className="divide-y divide-[var(--line)]">
            <ToggleRow
              description="New internship or new-grad postings from watched companies"
              label="Job openings"
            />
            <ToggleRow
              description="Confirmed and estimated recruiting date changes"
              label="Recruiting windows"
            />
            <ToggleRow
              description="New interview questions observed for watched companies"
              label="Interview intelligence"
            />
            <ToggleRow
              description="Daily digest of upcoming calendar tasks"
              label="Calendar reminders"
            />
          </div>
        </SettingsSection>

        <SettingsSection
          description="Connect external tools so RecruitIntel can push tasks, sessions, and deadlines where you already work."
          eyebrow="Connected accounts"
          id="integrations"
          title="Integrations"
        >
          <GoogleCalendarCard />
        </SettingsSection>
      </div>
    </>
  );
}
