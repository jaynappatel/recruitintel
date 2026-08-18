import json
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from recruitintel_collectors.domain.models import SourceConfig

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def load_fixture() -> Any:
    def load(name: str) -> Any:
        with (FIXTURES / name).open(encoding="utf-8") as handle:
            return json.load(handle)

    return load


@pytest.fixture
def source() -> SourceConfig:
    return SourceConfig(
        id=UUID("21000000-0000-0000-0000-000000000001"),
        company_id=UUID("10000000-0000-0000-0000-000000000001"),
        company_name="Acme, Inc.",
        provider="greenhouse",
        external_key="acme",
        name="Acme Greenhouse board",
        reliability=0.98,
        enabled=True,
        metadata={},
    )
