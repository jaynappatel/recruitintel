# Future ML dataset roadmap

RecruitIntel does not train or serve a prediction model in Milestone 1. The immediate job is to collect trustworthy, point-in-time recruiting history. A model should be attempted only after coverage, event stability, and label quality have been measured over multiple recruiting cycles.

## Candidate prediction task

An initial supervised task could estimate whether a company will open an internship within the next 7 days. Parallel 14-day and 30-day labels can be evaluated separately; they should not be mixed into one target.

Example label:

```text
internship_opened_within_next_7_days
```

For an as-of time `t`, the label is true when a first-party, deduplicated `JOB_OPENED` event for a normalized internship occurs in `(t, t + 7 days]`. Reopenings and corrections need explicit label policy. The training pipeline must retain the event and normalization versions used to construct each row.

## Point-in-time feature table

One row should represent one company at one daily as-of timestamp. Candidate columns include:

- `company_id`, industry, and coarse company attributes;
- day of year and recruiting-season indicators;
- `days_since_last_job_opened`;
- `jobs_opened_7d`, `jobs_opened_30d`, and `early_career_jobs_30d`;
- `recruiting_events_7d` and counts by permitted event family;
- `recruiter_activity_14d`;
- `career_page_changes_30d`;
- `github_question_updates_30d`;
- `campus_events_30d`;
- `previous_year_open_date` and `days_from_previous_year_open_date`;
- source coverage, collector freshness, and source reliability summaries.

Features from later milestones may be null until their collectors exist. Missingness and source coverage should be explicit features, not silently converted into evidence of no activity.

## Leakage prevention

- Build every feature with an `observed_at <= as_of_time` predicate. Do not use corrected or backfilled facts as if they were known earlier.
- Use `discovered_at` for system-knowledge timing; `occurred_at` or `published_at` alone can leak late-discovered events backward.
- Exclude any event inside the label window from feature aggregates.
- Fit normalization, imputation, encoders, thresholds, and feature selection on the training period only.
- Do not randomly split rows from the same calendar period. Near-duplicate company-day rows would make validation unrealistically easy.
- Version company merges, job classification, fingerprints, and closure rules so historical datasets can be reproduced.
- Audit vendor/source availability. A collector added late can create an apparent activity jump unrelated to hiring behavior.

## Evaluation design

Use rolling, time-based splits, for example:

```text
train: earliest complete periods
validation: following recruiting season
test: latest untouched recruiting season
```

Report precision/recall, PR-AUC, calibration, and alert volume at operational thresholds. Compare against simple seasonal and recency heuristics. Accuracy alone is inappropriate when openings are rare.

Start with regularized logistic regression because it is inexpensive, interpretable, and exposes data problems. Compare it with XGBoost or LightGBM only after the baseline is sound. Neural networks are not justified without substantially more history and clear evidence that simpler models plateau.

## Data readiness gate

Before training, require documented checks for event deduplication, temporal coverage, source outages, company-resolution stability, class balance, label review samples, and at least one untouched future period. Model output must be described as an estimate with calibration and uncertainty—not as recruiting truth.
