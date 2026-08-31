# M21 conditional ML promotion audit

M21 is an evidence gate, not a switch to enable ML. The repository currently
has no dataset carrying the required `REAL_CONSENTED` origin and recorded
consent metadata, no completed model evaluation, and no real elapsed shadow
history. Consequently all five candidates are `NOT_READY` and the existing
deterministic paths remain authoritative.

The admin-only readiness route reports aggregate counts and every promotion
gate; it never returns member rows, feature vectors, owner identifiers, or raw
private content. A dataset is not eligible evidence unless its M14 metadata
explicitly records `data_origin=REAL_CONSENTED`, `consent_recorded=true`, and
zero fixture rows. Recommendation impressions are denominators, not labels.

| Candidate            | Target and PIT feature boundary                                                                                                                                                 | Label                                                                                | Deterministic baseline                                 | Required evaluation / decision                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Personalized ranking | Save/apply/later positive stage for an impressed opportunity; constraints, fit, freshness, certainty, source quality, interest, prior actions and rank context as of impression | Impression-to-action/stage events                                                    | M9 versioned weighted score                            | User-aware temporal holdout; NDCG@k, MRR, recall@k and calibration; `NOT_READY`        |
| Opening forecast     | Opening within 7/14/30 days; prior first-open, seasonality, cadence and source/company activity as of prediction                                                                | First authoritative opening outside censored coverage                                | Historical median window/seasonal frequency            | Rolling-origin AUPRC, Brier, calibration, lead time and interval coverage; `NOT_READY` |
| Source anomaly       | Collection incident versus real activity change; per-source counts, errors, latency and coverage at observation time                                                            | Operator-confirmed incident/resolution                                               | M7 rolling median/MAD source rules                     | Time-series precision at alert budget, recall and time-to-detect; `NOT_READY`          |
| Resume outcome       | User-regarded fit and conditional advancement; deterministic evidence coverage, constraints, confirmed skills and job facts tied to resume version                              | Helpful/not-helpful, save/apply and later stage; never non-application as a negative | M11 hard constraints plus evidence-weighted coverage   | Temporal, user/entity-isolated ranking evaluation plus Brier/calibration; `NOT_READY`  |
| Interview topic      | Later topic distribution by company/role/stage/time; licensed dated, independent observations only                                                                              | Later independent observation or user-confirmed topic                                | M19 recency-weighted independent-observation frequency | Rolling-origin top-k recall, MAP and calibration; `NOT_READY`                          |

Every candidate must pass all of the following before a future, separately
approved promotion implementation can be considered: real consented labels,
reproducible fingerprinted dataset, PIT features, chronological holdout,
entity-leakage control, deterministic baseline win, calibration, privacy and
protected-feature review, real shadow history, model card, rollback,
monitoring, and zero-cost local operation. The gate evaluator has a pure unit
fixture showing that a complete evidence record is recognized, but it is not
persisted and cannot contribute to live readiness.

M14's deletion semantics remain applicable: private analytics facts, snapshots,
dataset members, assignments and predictions retain user foreign keys and
cascade on account deletion. A model trained in the future must document
retraining/deletion semantics; deletion must never be represented as removing
influence from an already-trained artifact without retraining.

No new dependency, dataset, model artifact, paid counter, network provider, or
database migration is introduced by this audit. The pre-existing M14 schema
allows only offline/shadow/disabled lifecycle states, so there is deliberately
no hidden or automatic production promotion path.
