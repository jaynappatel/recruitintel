import { listCompanies } from "@recruitintel/db";

import { CompanyCard } from "@/components/company-card";
import { DatabaseError } from "@/components/database-error";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  let companies;
  let errorMessage: string | undefined;
  try {
    companies = await listCompanies(100, 0);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : undefined;
  }

  if (!companies) {
    return (
      <>
        <PageHeader
          description="Companies we track, with every job and signal linked back to its source."
          eyebrow="Entity directory"
          title="Companies"
        />
        <DatabaseError message={errorMessage} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        description="Each company page brings together its name variations, current jobs, and recruiting history in one place."
        eyebrow="Entity directory"
        title="Companies"
      />
      {companies.items.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {companies.items.map((company) => (
            <CompanyCard company={company} key={company.id} />
          ))}
        </div>
      ) : (
        <EmptyState
          copy="Companies appear here automatically as recruiting sources are connected."
          title="No companies found"
        />
      )}
    </>
  );
}
