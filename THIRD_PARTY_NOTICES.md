# Third-party notices

RecruitIntel's Milestone 7 SSRF threat model and selected test cases were adapted in an original
Python implementation from OpenClaw's DNS-pinning, redirect, special-address, and ambient-proxy
guard patterns, particularly `src/infra/net/ssrf.ts`, `fetch-guard.ts`, and their tests. No OpenClaw
runtime or TypeScript source file is embedded wholesale.

## OpenClaw

Copyright (c) 2026 OpenClaw Foundation

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## FreeHire

RecruitIntel's Milestone 8 source-content/derivation hash separation, board-scoped identity, cheap
unchanged-write tests, and complete-source lifecycle safeguards, plus M9's bounded saved-opportunity
identity and notification deduplication concepts, are original Python/SQL adaptations informed by
FreeHire's `internal/sources/identity.go`, `internal/jobhash/jobhash.go`,
`internal/jobhash/rolefingerprint.go`, `cmd/ingest/store.go`, `cmd/ingest/board_health.go`, and
`openspec/changes/centralize-lifecycle-notifications/`. No Go source, source catalogue, location
dataset, proxy behavior, notification provider, or runtime was copied or embedded. M9's alert
fingerprints, transactional in-app provider, tri-state eligibility, and M7 integration are
RecruitIntel-specific adaptations. Expected savings: approximately 2-3 engineering days of
design/test discovery; no dependency or runtime cost was introduced.

Copyright (c) 2026 freehire contributors

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Upstream: https://github.com/strelov1/freehire

## Job Board Aggregator

RecruitIntel's Milestone 8 provider-aware identity/first-seen tests were informed by the
MIT-licensed `scripts/merge_data.py` from Job Board Aggregator. No scraper was incorporated and no
company, location, salary, trends, or generated-job dataset under the repository's CC BY-NC 4.0
`data/` boundary was imported.

Copyright (c) 2026 Riley Dorrington

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Upstream: https://github.com/Feashliaa/job-board-aggregator
