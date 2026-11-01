# Local skill catalog

The collector runs separately from user requests. Start once with `catalog-sync --config /absolute/config/catalog.json`; run `catalog-watch --config ...` as an explicit foreground service for continued updates. Set interval_seconds to 600, 1800 or 3600. The service does not register itself at login. GitHub credentials are optional environment variables, never catalog contents.

Trending pages supply dated momentum observations. Configured repositories supply additional skill inventory, not invented Trending membership. A sync checks repository metadata/commit and cached trees; verified blobs and prepared bundles are reused by content hash. Changed SKILL.md invalidates its semantic profile; changed supporting files invalidate readiness. Deleted skills are removed. Errors retain last usable data and are returned. Catalog snapshots publish atomically; sync and labeling share a lock. A crashed writer leaves sync.lock: confirm its PID has exited before removing it. Bounded repository batches rotate least recently inspected first. Hundreds of skills may require several batches; this is not a complete global GitHub index.

Every card stores full instructions, README excerpt, pinned source URL, source-extracted usage situations, inputs, outputs, constraints, and headings. These excerpts are not a semantic understanding claim. For deeper classification the host reads changed cards, writes an array of profiles and runs `catalog-label --file profiles.json`. Each profile needs `id`, `blob_sha`, string arrays `situations`, `inputs`, `outputs`, `constraints`, and `evidence` containing literal SKILL.md quotes. Include local-language task vocabulary in reviewed situations. The tool verifies quote presence and version, not truth of the interpretation. Reviews are reused until that skill blob changes.

## Request path

The calling agent writes a task file once per scope. The example maps a Korean request to public search terms while retaining the intent and constraint locally. Reviewed profiles may also match native-language keywords.

```json
{"operations":[{"intent":"버튼의 키보드 포커스 개선","keywords":["accessibility","keyboard","focus"],"constraints":["Keep the current Astro page and visual identity"]}]}
```

Run `catalog-route --file task.json` with up to 12 operations. Each operation returns up to three candidates with IDs, commit pins, licenses, descriptions, matched terms and retrieval scores. Real catalog IDs are `owner/repo:repository/path/SKILL.md`. Descriptions longer than 240 Unicode characters are flagged. `reviewed:true` marks a profile review pinned to that blob. When the snapshot contains a Trending observation for the repository, `trending` shows the latest observation's period, rank and language filter if present. An omitted observation means no evidence in this snapshot. An empty snapshot returns `empty_catalog`. A populated snapshot with zero candidates returns `no_matches`. With partial coverage, inspect empty operations individually. The host decides which candidates are worth checking and may decline all of them.

Use the same cache across these stages:

1. `catalog-detail --trace TRACE_ID ID [ID ...]` reads the selected candidates from one local trace. It retains source excerpts with line numbers, any pinned semantic review and quotes, the pinned source URL, commit and blob SHA, license, popularity observations and local readiness if available. The trace retains the original evidence if the catalog refreshes and stores each shortlisted profile once alongside the task's intents and constraints. `catalog-route --details` expands every profile for clients that need the earlier inline format.
2. After choosing a skill, `read owner/repo --ref FULL_SHA --file path/to/SKILL.md --text` emits the verified UTF-8 entrypoint without a JSON wrapper or preview cutoff. This loads one commit-pinned file within the existing 2 MiB file limit. Check the exit code. Add `--offline` to require a cached tree and blob. Choose supporting files from the entrypoint and use the same `read` command with their repository-relative paths.
3. If execution requires files on disk or a directory layout, use `prepare owner/repo --path path/to/SKILL.md --ref FULL_SHA` for the chosen skill and use its entrypoint. Prepare materializes a bundle. Add `--offline` when the bundle inputs are already cached.

With one ID, detail returns `candidate` with the original profile. With multiple IDs, it returns `candidates` in request order with duplicate IDs removed. A batch fails if any ID is absent from the trace. In the batch's `indexed_excerpts` format, each profile's `excerpts` array stores `[line, text]` pairs. The five groups `situations`, `inputs`, `outputs`, `constraints` and `headings` list zero-based indices into that array. For example, `constraints: [2]` points to `excerpts[2]`. The semantic review retains its original structure.

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

The first lookup downloads metadata only. TTL/ETag caching reuses the snapshot for subsequent local matching. With `--offline`, a warm cached route makes zero requests and a cold miss fails explicitly. HTTP failures may use a checksum-verified stale cache with warnings. Remote profiles cannot provide local entrypoint paths or claim a bundle is installed on the user's machine. Initial catalog transfer and reads of uncached selected files still cost time.

Queries, private task content, selection traces, local paths and execution outcomes are not uploaded to the read service. The export contains a fixed allowlist of GitHub provenance and capability fields, omits source excerpts containing local home paths, and excludes semantic reviews containing such paths. These omissions do not remove the pinned source link for later inspection. The server has no ingestion/write/execute endpoint. Publication requires the operator's hosting/storage permissions, kept separate from readers.
