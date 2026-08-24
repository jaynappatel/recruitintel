import json
from pathlib import Path
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from .models import SearchResult


class StaticSearchProvider:
    """Credential-free provider used for local development and deterministic tests."""

    def __init__(self, results: dict[str, list[SearchResult]]) -> None:
        self._results = results

    @property
    def name(self) -> str:
        return "static"

    async def search(self, query: str, *, max_results: int) -> tuple[SearchResult, ...]:
        return tuple(self._results.get(query, ())[:max_results])


class JsonFileSearchProvider(StaticSearchProvider):
    def __init__(self, path: Path) -> None:
        raw: Any = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("static search result file must contain a JSON object")
        adapter = TypeAdapter(list[SearchResult])
        parsed = {str(query): adapter.validate_python(results) for query, results in raw.items()}
        super().__init__(parsed)


class SearchProvider(Protocol):
    @property
    def name(self) -> str: ...

    async def search(self, query: str, *, max_results: int) -> tuple[SearchResult, ...]: ...


class SearchProviderDescriptor(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str = Field(pattern=r"^[a-z0-9_-]+$")
    production_capable: bool
    official_api: bool
    api_hosts: tuple[str, ...] = ()
    credential_environment_names: tuple[str, ...] = ()
    minimum_interval_seconds: int = Field(ge=60)
    maximum_daily_queries: int = Field(ge=0)
    cost_metadata: dict[str, int | str | bool] = Field(default_factory=dict)
    terms_status: str = Field(pattern=r"^(DEVELOPMENT_ONLY|REVIEW_REQUIRED|REVIEWED)$")


STATIC_SEARCH_DESCRIPTOR = SearchProviderDescriptor(
    name="static",
    production_capable=False,
    official_api=False,
    minimum_interval_seconds=60,
    maximum_daily_queries=0,
    cost_metadata={"billable": False},
    terms_status="DEVELOPMENT_ONLY",
)


class SearchProviderRegistry:
    def __init__(
        self,
        providers: list[SearchProvider],
        descriptors: list[SearchProviderDescriptor] | None = None,
    ) -> None:
        self._providers = {provider.name: provider for provider in providers}
        values = descriptors or [STATIC_SEARCH_DESCRIPTOR]
        self._descriptors = {descriptor.name: descriptor for descriptor in values}
        if set(self._providers) != set(self._descriptors):
            raise ValueError("every search provider requires exactly one reviewed descriptor")

    def get(self, name: str) -> SearchProvider:
        try:
            return self._providers[name]
        except KeyError as exc:
            raise KeyError(f"search provider {name!r} is not configured") from exc

    def descriptor(self, name: str) -> SearchProviderDescriptor:
        try:
            return self._descriptors[name]
        except KeyError as exc:
            raise KeyError(f"search provider descriptor {name!r} is not configured") from exc
