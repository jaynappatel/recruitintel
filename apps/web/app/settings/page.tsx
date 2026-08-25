import { GoogleCalendarCard } from "@/components/settings/google-calendar-card";
import { RecruitingPreferencesCard } from "@/components/settings/recruiting-preferences-card";
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
          <RecruitingPreferencesCard />
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
