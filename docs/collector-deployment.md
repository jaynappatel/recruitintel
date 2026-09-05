# Collector deployment

Vercel hosts the Next.js web application. It does not run the Python scheduler or
workers, so production needs a separate long-running deployment connected to the
same PostgreSQL database.

## Required runtime

Build `Dockerfile.collectors` and run these two processes:

```bash
recruitintel-collectors scheduler
recruitintel-collectors worker --classes ATS,GITHUB,WEB_SEARCH,WEB_FETCH,PROJECTION,CONTROL,RESUME
```

`docker-compose.production.yml` defines both services. A managed container host can
use the same image with the commands above as separate services.

Use a PostgreSQL login bound to the worker capability role rather than the web
application login. The scheduler needs the scheduler capability; the worker needs
the allowed global work classes. See `docs/orchestration-source-governance.md` for
the role-binding commands.

## Environment

The collector services require:

- `COLLECTOR_DATABASE_URL`: pooled or direct PostgreSQL URL for the collector role;
- `RECRUITINTEL_USER_AGENT`: an honest identifying agent with a monitored contact;
- `ZERO_COST_MODE=true`;
- `GITHUB_TOKEN` only if the configured GitHub sources need higher public API limits.

Run migrations before starting the services. Do not run the development seed against
production; it creates synthetic jobs and development-only source policies.

## Source coverage

The current production-safe adapters are Greenhouse and Lever. They only collect
configured, reviewed sources; they do not discover every job board automatically.
Each live source needs a canonical company, provider, public tenant key, enabled
source row, executable source policy, and enabled schedule. Start with one source,
inspect its collector run and errors, then expand the catalog.

General web search remains disabled by default. It requires a reviewed search
provider and source policy; arbitrary or authenticated scraping is not enabled.
