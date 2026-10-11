# SOO execution and quality rules

Load this reference at the first compute, processing-mode, quality, monitoring, test, or recovery decision. Apply it to every later pipeline.

## Compute engine

Use current Palantir MCP documentation and dataset statistics. Evaluate required APIs, supported Expectation and Check severities, volume, row width, joins, aggregation, shuffle, skew, memory, concurrency, build-time objective, and growth.

Start with Polars as the lightweight candidate. Select Spark when required features or distributed scale justify it. For Spark, use `get_spark_profile_documentation`. Record partitioning, shuffle and skew strategy, profile, and driver and executor needs. Record the selected and rejected engines, evidence, limitations, and reversal condition.

## Processing mode

Choose full rebuild with justification or incremental processing with explicit transaction semantics for every transform. For incremental processing, record the source change model, stable keys, input and output transaction modes, append/update/delete behavior, late corrections, checkpoint or cursor, replay, retry, idempotency, and `semantic_version` rebuild behavior.

WARNING: Code Repository preview runs non-incrementally and cannot prove incremental correctness.

Use an actual development build or supported VS Code preview. Test the initial build, incremental update, applicable delete or correction, retry, and full rebuild. Data Expectations evaluate the full dataset during incremental builds.

## Expectations and Checks

Add meaningful named Checks at each relevant contract boundary. Select applicable invariants from schema and required columns, nullability, key uniqueness, valid values and ranges, referential assumptions, content, and row count.

Use `FAIL` when a violation makes downstream data incorrect or unsafe. Use `WARN` when it is diagnostic and the output remains valid. All `FAIL` Checks must pass. Give every failed `WARN` an owner. Record its decision and follow-up. Check current documentation before using `FAIL` for single-node or virtual-table outputs. Use only severities supported by the engine and output type.

## Monitoring

Monitor every pipeline without redundant checks. Configure Schedule Status and Schedule Duration at schedules. At resolved inputs, use schema checks that permit intentional compatible additions where appropriate. At consumer-facing outputs, configure Time since last update and schema checks. Use Data Freshness only with a suitable source-event timestamp. At Data Connection boundaries, monitor sync status or freshness only when the corresponding sync exists. Monitor an intermediate dataset only when a user, application, or external sync consumes it directly.

Record the alert owner, threshold rationale, escalation path, and response procedure.

## Tests and recovery

Scale unit cases to material logic. Cover applicable valid, missing, malformed, duplicate, boundary, empty, join-cardinality, deterministic-repeat, incremental, and idempotent cases. Run repository CI and development dataset builds.

For each applicable connection failure, partial ingestion, failed `FAIL`, accepted or escalated `WARN`, corrupt transaction, transform failure, downstream failure, incremental-state failure, and full-rebuild requirement, record detection, containment, retry, recovery, owner, and verification. Test one representative failure and recovery path for each material pipeline.
