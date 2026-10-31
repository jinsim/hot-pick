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
