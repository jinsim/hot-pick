# Community-skill operations

For general GitHub open source, Trending and executable task plans, see [oss-workflow.md](oss-workflow.md). The limits below concern the community-skill path.

Requires Node.js 22+. Script path is relative to this skill directory:

```sh
node scripts/hot-pick.mjs search "react performance"
node scripts/hot-pick.mjs inspect vercel-labs/skills@find-skills
node scripts/hot-pick.mjs prepare vercel-labs/skills@find-skills --ref FULL_COMMIT_SHA --content
node scripts/hot-pick.mjs refresh --limit 10
node scripts/hot-pick.mjs status
```

Global options: `--cache DIR`, `--offline`, `--refresh`, `--ttl 600`, `--timeout 8000` (per request). Search supports `--owner ORG`, `--limit N`, `--api HTTPS_REGISTRY`; loopback HTTP is allowed for reproducible benchmarks. `inspect`/`prepare` support `--path skills/name/SKILL.md`, `--ref BRANCH_OR_40_CHARACTER_SHA`. Omit `--ref` to resolve the default branch. Every operation prints JSON; errors have `ok:false` and exit code 1. Successful search with no results has `ok:true,candidates:[]`.

Default cache: `~/.cache/hot-pick`. HTTP entries use URL hashes, ETags, timestamps, and SHA-256 content checks. When at least four files are missing, the registry snapshot API is attempted once; only files matching the pinned Git hashes are accepted, and remaining files use GitHub raw downloads. File blobs are checked against Git's blob SHA-1 from a commit-pinned tree, and prepared bundles are verified on reuse. The cache is private to the local user; no defense against a fully compromised local account is claimed. Remove a dedicated curator cache directory when unused to reclaim disk. Cached skill code should not write into its bundle: use the task's output directory.

`refresh` is a bounded one-shot collector. A user-managed scheduler can invoke it every ten minutes, choosing a request budget appropriate to the account. This package does not register a daemon, cron, paid CI, or an automation. A sweep of thousands of repos every ten minutes will exceed many GitHub quotas. Use staggered batches, cached search, and demand-driven resolution. GitHub REST authentication uses `GITHUB_TOKEN` if already provided; it is never echoed or forwarded to raw-content or registry hosts. No retries on rate limit; the caller can retry later. Each request times out; a full operation can take several request timeouts.

Limits: public GitHub sources, complete tree responses, 200 files / 20 MiB per skill directory / 2 MiB per file; no symlinks or submodules. Relative paths inside the skill directory are preserved. Resources outside that directory need a separately reviewed acquisition step. Private repositories, non-GitHub providers, MCP provisioning and automatic package dependency installation are out of scope for v0.1. Prefer upstream `skills` for those workflows.

Registry search recall is upstream-defined. Local BM25 is a fallback over previously inspected instructions when the registry fails; it is not an embedding model or learned ranker. README and instructions supply evidence to the host LLM, which makes the final choice. There is no built-in LLM API or key requirement. No output-quality improvement has been statistically established merely by shipping this router.

The ecosystem already offers `skills use` without installation and can print a prompt for the current conversation. The curator's intended gains are persistent reuse, explicit error states, structured evidence, and a task-completion policy. See the repository's HTML evaluation report and reproducible benchmark, not an unconditional "faster/better" claim.
