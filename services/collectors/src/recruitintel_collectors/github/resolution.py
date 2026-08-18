from collections.abc import Iterable
from uuid import UUID

from recruitintel_collectors.domain.normalization import CompanyResolver, normalize_company_name

from .models import GitHubRepositoryLink


class GitHubCompanyResolver:
    """Exact normalized alias resolver with repository-scoped explicit mappings."""

    def __init__(
        self,
        *,
        aliases: dict[str, UUID],
        domains: dict[str, UUID],
        links: Iterable[GitHubRepositoryLink],
    ) -> None:
        self._links = tuple(link for link in links if link.enabled)
        merged_aliases = dict(aliases)
        for link in self._links:
            rules = link.company_mapping_rules
            configured = rules.get("aliases", [])
            if isinstance(configured, list):
                for alias in configured:
                    if isinstance(alias, str) and normalize_company_name(alias):
                        merged_aliases[alias] = link.company_id
        self._resolver = CompanyResolver(
            aliases={key: str(value) for key, value in merged_aliases.items()},
            domains={key: str(value) for key, value in domains.items()},
        )

    def resolve(self, name: str | None) -> UUID | None:
        if name:
            resolved = self._resolver.resolve(name=name)
            return UUID(resolved) if resolved else None
        if len(self._links) == 1:
            return self._links[0].company_id
        return None
