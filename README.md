# hot-pick

**Find trending GitHub open source that fits your task. Apply it. Verify the result.**

hot-pick is one agent skill with a dependency-free Node.js CLI. The host agent understands your task and selects suitable libraries, CLI tools, frameworks, agents, skills or MCP projects. The CLI supplies actual GitHub Trending observations, repository evidence, pinned checkouts, caching and executable task plans with verification receipts.

Node.js 22+ and Git are required. Applying a selected project may need its own runtime and dependencies. No LLM API key is required by hot-pick.

## Quick start

Requires **Node.js 22+ and Git**. The CLI has no npm dependencies and needs no LLM API key. Your coding agent supplies the reasoning; hot-pick supplies discovery, source evidence and execution receipts.

```sh
git clone https://github.com/jinsim/hot-pick.git
cd hot-pick
npm run hot-pick -- discover "web scraping python" --since weekly
```

### Use it with Codex

Link the one entrypoint skill from your checkout (the command fails safely if that path already exists):

```sh
mkdir -p ~/.codex/skills
ln -s "$PWD/skills/hot-pick" ~/.codex/skills/hot-pick
```

Start a new agent session, then give it your actual task:

> $hot-pick Find a suitable trending GitHub project and use it to extract product names, prices and stock from these HTML files. Produce JSON and verify the values.

The agent discovers relevant projects, reads their capabilities, selects a suitable one, applies it and checks the output. It can use **libraries, CLI tools, frameworks, agents, skills and MCP projects**. You do not need to install each discovered skill globally. Existing MCP services can be used; automatic MCP provisioning is not implemented.

Ordinary authorized work continues without repeated “may I use this project?” prompts. The host agent's permissions still apply. Other agents can use the CLI and [skill instructions](skills/hot-pick/SKILL.md); their native skill installation varies.

## What has actually been verified?

Local validation on **2026-11-07 (KST)** used [Scrapling](https://github.com/D4Vinci/Scrapling) at commit `bc602488b44e978da3266841e913af17577ec0fd`, discovered from a task search and a weekly Trending observation.

| Check | Observed result | Inspect the evidence |
| --- | --- | --- |
| Parse two HTML layouts with the selected library | 4 exact product records; 2 invalid-input cases rejected | [Output](examples/product-extraction/products.json), [assertions](examples/product-extraction/verify.py) |
| Fetch and parse a real practice catalog | 20 distinct books exported to JSON and CSV; field and price checks passed | [JSON](examples/product-extraction/books.json), [CSV](examples/product-extraction/books.csv) |
| CLI regression suite | 31 tests passed locally | [Tests](tests), run `npm test` |

[Validation data](docs/oss-validation.json) includes the source commit, dated Trending signals, command outcomes and artifact hashes. Local machine paths are normalized for publication, with the dependency snapshot transformation explicitly recorded. These are two working integrations, **not evidence of universal superiority over other agents or skills**.

Reproduce the fixture example (also requires **Python 3.10+**, network access and a Unix-like shell):

```sh
npm run hot-pick -- apply --plan examples/product-extraction/plan.json
```

This downloads the pinned project, installs it into the example's local `.venv`, extracts the products and runs assertions. See the live example below for the public catalog.

## Central catalog, no always-on LLM

The operator's scheduled pipeline collects changed GitHub metadata and source files. A separate local agent session reviews newly added or changed skills in finite batches. The published snapshot contains source-backed profiles; the collector and read service make **no LLM API calls**.

Users connect the skill to the published catalog:

```sh
npm run hot-pick -- catalog-connect --catalog-url https://jinsim-hot-pick.web.app/catalog.json
npm run hot-pick -- catalog-route --file task.json
```

Use the URL for your deployment. The client downloads metadata, reuses it with TTL/ETag caching and matches task operations locally. The current agent summarizes the task once, checks fit and selects candidates. User prompts and selection traces stay local.

The public catalog above is live on Firebase Hosting. Its operator currently collects and publishes every 30 minutes from a local Mac; refresh pauses while that machine is offline or its operator login needs renewal. The last published catalog stays available. This is not yet a cloud-hosted collector. Neither collection nor publication calls an LLM.

The default shortlist omits inline profiles. Use `catalog-detail --trace TRACE_ID ID [ID ...]` to retrieve pinned evidence for the candidates you need in one call, or `catalog-route --details --file task.json` for inline profiles. After choosing, use `read REPO --ref COMMIT --file PATH --text` to load the entrypoint and read individual supporting files as needed. Warm routing and trace detail work offline.

[Service and deployment guide](service/README.html) · [Catalog schemas and review workflow](skills/hot-pick/references/catalog.md)

## Operator setup and local development

The catalog collector runs outside the request path. It stores commit-pinned SKILL.md instructions, source-backed capability excerpts, optional reviewed intent/output profiles and prepared supporting files. GitHub Trending observations stay separate from seeded skill repositories.

```sh
npm run hot-pick -- catalog-sync --config config/catalog.json
npm run hot-pick -- catalog-watch --config config/catalog.json
# In the agent's task, using a small operation description:
npm run hot-pick -- catalog-route --file task.json
```

The default interval is 30 minutes; 10 and 60 minutes are supported. `catalog-watch` is an explicitly launched foreground worker, not a login service. Local routing performs no remote search, installation or LLM API call. The host agent still judges fit and applies selected instructions. A small button fix should load relevant UI guidance, not choose a whole new framework.

See [catalog configuration, classification, offline application and audit traces](skills/hot-pick/references/catalog.md). No claim of zero overhead or autonomous semantic understanding is made: extracted passages are distinguished from host-reviewed profiles. Cold indexing and bundle preparation can be expensive; readiness and errors are reported.

## General GitHub workflow

```sh
npm run hot-pick -- discover "web scraping python" --since weekly
npm run hot-pick -- trending --since daily --language python
npm run hot-pick -- repo D4Vinci/Scrapling
npm run hot-pick -- read D4Vinci/Scrapling --ref FULL_COMMIT_SHA --file docs/parsing/selection.md
npm run hot-pick -- acquire D4Vinci/Scrapling --ref FULL_COMMIT_SHA --workspace /path/to/task
npm run hot-pick -- apply --plan /path/to/task/plan.json
```

For pure JSON output without npm's lifecycle banner, invoke `node skills/hot-pick/scripts/hot-pick.mjs …` directly.

`discover` combines GitHub task search with observed Trending cards. Stars, recent period stars, search relevance and timestamps remain separate. The host reads README, license, manifests and needed code before deciding applicability. No fabricated composite quality score is used.

`acquire` creates a clean commit-pinned checkout without running build scripts. `apply` executes a **local plan written and reviewed by the host**, then requires explicit checks and output artifacts. A receipt records step outcomes and artifact SHA-256 hashes. The runner is not an OS sandbox; it does not infer safe commands from a remote README. See [the complete plan format](skills/hot-pick/references/oss-workflow.md).

## Real application, not just retrieval

[Product extraction example](examples/product-extraction/plan.json): the discovered GitHub project `D4Vinci/Scrapling` is acquired at an exact commit and installed in a task-local virtual environment. Its parser extracts four exact product records from two layouts. Checks cover nested text, HTML entities, Korean names, exact decimal prices, stock and invalid inputs.

```sh
npm run hot-pick -- apply --plan examples/product-extraction/plan.json
```

[Live catalog example](examples/product-extraction/live-plan.json) applies the same library to the public Books to Scrape practice site, producing JSON and CSV. It requires network access and intentionally fails if the expected source shape changes.

```sh
npm run hot-pick -- apply --plan examples/product-extraction/live-plan.json
```

These are real integrations, not a blind benchmark of output quality across all tasks. See [v0.2 validation](docs/oss-validation.html) for observed results and limitations. Dependencies resolved during validation are recorded in the example; the source itself is pinned. Future dependency resolution can change unless separately locked.

## Existing community-skill workflow

```sh
npm run hot-pick -- search "react performance"
npm run hot-pick -- inspect vercel-labs/skills@find-skills
npm run hot-pick -- prepare vercel-labs/skills@find-skills --ref FULL_COMMIT_SHA --content
npm run hot-pick -- refresh --limit 10
```

Supporting files and relative paths are preserved without globally installing each community skill. Existing cache and snapshot validation remain supported. [Skill command reference](skills/hot-pick/references/operations.md).

## Cache, provenance and scope

Mutable HTTP data has a 600-second TTL, conditional requests and explicit stale/offline indicators. Commit trees and verified file blobs are reused. `data_checked_at` is the actual data-check time; reading a cache does not fabricate a newer observation of upstream state. HTTP request metrics exclude Git transfer and subprocess package installation. No telemetry is sent. Request commands never start a scheduler; the optional catalog worker runs separately.

The Trending adapter reads GitHub's public HTML, which may change or become unavailable. It reports failure instead of inventing ranks. The discover command is demand-driven; the optional collector maintains a bounded local catalog, not a complete global index. Public GitHub sources are supported; private credentials, binary release installation, LFS hydration, automatic MCP provisioning and arbitrary dependency resolution remain host-specific. Tree/file limits are explicit. Source preparation, successful commands and successful user outcomes are different states.

## Development and evidence

```sh
npm test
```

- [Product purpose](docs/product-purpose.html)
- [v0.2 design](docs/oss-implementation.html) and [validation](docs/oss-validation.html)
- [Catalog token benchmark](docs/token-validation.html) and [measurements](docs/token-validation.json)
- [Historical v0.1 benchmark](docs/evaluation.html) and [raw measurements](docs/benchmark-results.json)
- [REA evidence summary](docs/rea-summary.json)

The historical benchmark measures the earlier skill-only implementation, not v0.2 GitHub discovery or task execution. Research downloads, task virtual environments and pinned checkouts are ignored by Git. [MIT license](LICENSE).
