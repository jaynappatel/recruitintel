import json
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter

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


class SearchProviderRegistry:
    def __init__(self, providers: list[StaticSearchProvider]) -> None:
        self._providers = {provider.name: provider for provider in providers}

    def get(self, name: str) -> StaticSearchProvider:
        try:
            return self._providers[name]
        except KeyError as exc:
            raise KeyError(f"search provider {name!r} is not configured") from exc
