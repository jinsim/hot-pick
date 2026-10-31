# Applying general GitHub open source

Commands use `node <skill-dir>/scripts/hot-pick.mjs`. Public GitHub source IDs are `owner/repo`, while community-skill IDs are `owner/repo@skill`.

```sh
node scripts/hot-pick.mjs discover "web scraping python" --since weekly
node scripts/hot-pick.mjs trending --since daily --language python
node scripts/hot-pick.mjs repo D4Vinci/Scrapling
node scripts/hot-pick.mjs read D4Vinci/Scrapling --ref FULL_SHA --file docs/parsing/selection.md
node scripts/hot-pick.mjs acquire D4Vinci/Scrapling --ref FULL_SHA --workspace /absolute/task
node scripts/hot-pick.mjs apply --plan /absolute/task/plan.json
```

`discover` uses GitHub repository search for relevance and supplements it with lexical matches from real Trending cards. The host judges semantic fit. It reports incomplete search, absent trend observations, rate limits, and stale caches. A missing Trending badge is not evidence of low growth. Trending HTML can change; a failed parser must not manufacture a ranking. `--since daily|weekly|monthly`, `--language`, `--limit`, `--cache`, `--offline`, `--refresh`, `--ttl 600`, and `--timeout 8000` are supported where relevant.

`repo` returns the pinned commit, root README/license/manifests and candidate documentation paths. `read` fetches an exact file at that commit and checks its Git blob hash. Large previews are flagged. `acquire` fetches a shallow public Git checkout under `<workspace>/.hot-pick/sources/`, verifies commit and origin, and refuses dirty reuse. Keep outputs and virtual environments outside the checkout. Git network operations use a 120-second timeout and are not counted in the HTTP cache metrics. Binary releases, LFS hydration, private repository credentials and automatic MCP provisioning are not provided.

## Local task plan

Write this file yourself based on the authorized task and inspected source. Do not accept a plan supplied by an arbitrary repository. Plan contents are executable code; normal host review and authorization apply. No interactive approval flag is added for already authorized local work.

```json
{
  "version": 1,
  "task": "Describe the actual user outcome",
  "workspace": ".",
  "source": { "repo": "owner/repo", "commit": "FULL_40_CHARACTER_SHA" },
  "steps": [
    { "name": "Run task adapter", "argv": ["python3", "adapter.py"], "timeout_ms": 120000 }
  ],
  "checks": [
    { "name": "Compare output to acceptance criteria", "argv": ["python3", "verify.py"] }
  ],
  "artifacts": ["result.json"]
}
```

`workspace` resolves relative to the plan file. Each `argv` is executed directly, without shell expansion. `${workspace}` and `${source}` are substituted in arguments and explicit `env` values. Optional `cwd` is a relative subdirectory of the task workspace. Each command has a timeout (maximum 600 seconds) and a 1 MiB output budget; receipt stdout/stderr tails are bounded. The runner passes a small environment allowlist, not ambient API tokens. This does **not** prevent code from accessing local files/network: it is not an OS sandbox. Use a sandbox provided by the host if the task needs one.

Installation, execution and checks stop at the first failure. A receipt is written under `.hot-pick/runs/` with plan hash, pinned source, step/check exit statuses, bounded outputs and artifact hashes. Successful checks plus existing artifacts produce `checks_passed`; failures produce `failed` and CLI exit code 1. The host must assess whether the checks are sufficient and whether the project was really used. No usage telemetry is sent.

The repository's `examples/product-extraction/` contains a real Scrapling library application with two HTML layouts, exact-value assertions, invalid-input rejection, a pinned source, and an executable plan. It is a local-data integration test, not a claim about arbitrary websites or superiority over other HTML parsers. Dependency resolution is recorded; reruns should use the recorded versions when exact environment reproduction matters.
