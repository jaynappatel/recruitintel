# Milestone 13 implementation plan

Status: implemented as the bounded gateway foundation. The authoritative objective is the M13 section of `final-architecture-roadmap.md`: AI is optional assistance for ambiguous unstructured evidence only after rules, deterministic parsing, normalization, retrieval, and cache lookup.

## Boundary

M13 never decides identity, authorization, ownership, canonical opportunity identity or lineage, eligibility, score/rank, application lifecycle, provenance, or side effects. It may return a bounded requirement/evidence proposal, grounded prose, or a resume wording suggestion. Domain code accepts only cited proposals. An absence of a local provider is a complete deterministic path.

## Contract

The gateway uses versioned task/schema/prompt/redaction identifiers, input/source hashes, bounded typed input/output, source evidence references, provider-neutral execution, safe statuses, owner-scoped immutable cache keys, and no raw prompt/response persistence. Source content is untrusted data: embedded instructions, URLs, tool requests, secret requests, and eligibility assertions have no authority. Evidence proposals require an existing cited span; unsupported output is rejected, and ambiguity abstains.

`ZERO_COST_MODE=true` blocks paid providers before execution. Local/mock providers are permitted for tests. No provider SDK or network dependency was added. Calls record safe metadata and usage only; prompts, raw resume text, raw DOM, cookies, storage, credentials, and secrets are excluded.

## Integration and privacy

M13 tables are additive after M12. User-specific calls and outputs cascade on account deletion; shared job facts require separate public-source validation and cannot silently replace deterministic requirements. M8 lineage, M9 score/impression semantics, M10 application events, M11 evidence/match scores, and M12 permissions/selected-only bounded content remain unchanged. M7 remains the only worker runtime; queued AI work, if enabled in a later provider deployment, carries only IDs/fingerprints and uses existing fencing/retry/dead-letter mechanics.

## Verification matrix

Permanent gateway tests cover deterministic fallback, paid zero-cost block, local/mock structured output, evidence-span grounding, prompt-injection-as-data, malformed output rejection, and cache reuse. Migration tests cover the metadata-only schema and user cascade. Existing M6 export/delete and M7 cancellation/fencing contracts continue to govern private records and worker races.

## Out of scope

No commercial provider activation, agent framework, embeddings, autonomous applications, opaque ranking, canonical merge suggestion, bulk raw-DOM upload, training/prediction, or automatic resume replacement.
