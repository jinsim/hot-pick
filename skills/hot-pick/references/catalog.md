# Local skill catalog

The collector runs separately from user requests. Start once with `catalog-sync --config /absolute/config/catalog.json`; run `catalog-watch --config ...` as an explicit foreground service for continued updates. Set interval_seconds to 600, 1800 or 3600. The service does not register itself at login. GitHub credentials are optional environment variables, never catalog contents.

Trending pages supply dated momentum observations. Configured repositories supply additional skill inventory, not invented Trending membership. A sync checks repository metadata/commit and cached trees; verified blobs and prepared bundles are reused by content hash. Changed SKILL.md invalidates its semantic profile; changed supporting files invalidate readiness. Deleted skills are removed. Errors retain last usable data and are returned. Catalog snapshots publish atomically; sync and labeling share a lock. A crashed writer leaves sync.lock: confirm its PID has exited before removing it. Bounded repository batches rotate least recently inspected first. Hundreds of skills may require several batches; this is not a complete global GitHub index.

Every card stores full instructions, README excerpt, pinned source URL, source-extracted usage situations, inputs, outputs, constraints, and headings. These excerpts are not a semantic understanding claim. For deeper classification the host reads changed cards, writes an array of profiles and runs `catalog-label --file profiles.json`. Each profile needs `id`, `blob_sha`, string arrays `situations`, `inputs`, `outputs`, `constraints`, and `evidence` containing literal SKILL.md quotes. Include local-language task vocabulary in reviewed situations. The tool verifies quote presence and version, not truth of the interpretation. Reviews are reused until that skill blob changes.

## Request path: no network

Translate the request into one or more specific operations. Use public keywords, not private task content. For “fix this button”, don't query for an entire website framework.

```json
{"operations":[{"intent":"Improve button keyboard focus","keywords":["accessibility","keyboard","focus"],"constraints":["Keep the current Astro page and visual identity"]}]}
```

Run `catalog-route --file task.json`. It reads only the local snapshot and records a trace under `<cache>/task-catalog/traces/`. No network, clone, package install, LLM API call or catalog refresh occurs. Each operation returns up to three candidates and source-backed profiles. Retrieval scores are term relevance, not success probabilities. The host reasons about intent, constraints and expected outputs, chooses compatible skills without redundant scope, and may decline all candidates. Empty catalog/results are explicit; continue with available tools or report missing coverage rather than synchronously indexing GitHub.

For a ready candidate, validate and load it with `prepare owner/repo --path path/to/SKILL.md --ref SHA --offline --content`, using the same cache. Read the full entrypoint if truncated and only the supporting references needed by this operation. Apply to the existing task; do not rebuild an app to demonstrate a skill. If a required bundle or runtime is absent, disclose the setup cost; no zero-latency guarantee is made.

After applying, `catalog-record --file outcome.json` attaches host-reported decisions, artifacts and checks to the trace:

```json
{"trace_id":"UUID from route","decisions":[{"id":"candidate id","status":"used","reason":"Source guidance addresses keyboard focus without changing stack","artifacts":["src/button.css"],"checks":["Keyboard focus remains visible"]}]}
```

Use `rejected` with a reason for unsuitable candidates. Recording is not an independent test execution; use actual task checks or `apply` receipts as evidence. Traces contain sanitized intents and local artifact paths, remain private locally, and are never sent as telemetry. Operators control retention by deleting old trace files. `catalog-status` reports coverage/readiness and the latest errors.

## Central catalog: operator pipeline, lightweight user skill

Operators collect GitHub deltas on a scheduled job and publish a sanitized snapshot. The collector and HTTP service never call an LLM. A separate local agent session can run `catalog-review-queue --limit 20`, read only pending/changed source records, produce evidence-backed profiles, run `catalog-label`, and export again. This is a finite review task, not a continuously running LLM. Unreviewed records remain visibly source-extracted; never label the whole catalog semantically reviewed after one batch.

```sh
# Operator, after collecting/reviewing:
node scripts/catalog-export.mjs --cache /persistent/cache --out /published/catalog.json
# User, using the actual published HTTPS URL:
npm run hot-pick -- catalog-connect --catalog-url https://YOUR_CATALOG_HOST/v1/catalog
npm run hot-pick -- catalog-route --file task.json
```

`catalog-connect` saves the endpoint locally across agent sessions. `--catalog-url URL` and then `HOT_PICK_CATALOG_URL` take precedence over that saved connection. Firebase Hosting can serve the exported JSON at a static URL; the read-only service exposes `/v1/catalog` for Cloud Run or another Node host. This is HTTP catalog synchronization, not a claim of a fully implemented MCP transport. No production URL is bundled before deployment is verified.

The first lookup downloads metadata only. TTL/ETag caching reuses the snapshot for subsequent local matching; `--offline` uses the cache and fails explicitly on a cold miss. HTTP failures may use a checksum-verified stale cache with warnings. Remote profiles cannot provide local entrypoint paths or claim a bundle is installed on the user's machine. Fetch and validate only chosen pinned skill bundles with `prepare`; later reuse them offline. Initial catalog transfer, initial skill preparation and skill execution still cost time.

Queries, private task content, selection traces, local paths and execution outcomes are not uploaded to the read service. The export contains a fixed allowlist of GitHub provenance and capability fields, omits source excerpts containing local home paths, and excludes semantic reviews containing such paths. These omissions do not remove the pinned source link for later inspection. The server has no ingestion/write/execute endpoint. Publication requires the operator's hosting/storage permissions, kept separate from readers.
