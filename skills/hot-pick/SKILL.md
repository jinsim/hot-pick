---
name: hot-pick
description: "Find trending GitHub open-source projects that fit a user's task, inspect their real capabilities, and apply them to deliver and verify the result. Covers libraries, CLI tools, frameworks, agents, skills, and MCP projects. Use when the user requests open-source discovery/application or a task or focused edit benefits from specialist guidance, including UI accessibility, component styling, animation, analysis and validation. Reuse the local catalog before remote discovery."
---

# hot-pick

Use `node <skill-dir>/scripts/hot-pick.mjs …` with Node.js 22+. Finish the user's task and verify the result. Reuse a suitable tool or a previously verified pin when it still fits.

## Decide whether external help adds value

For a known mechanical fix or standard-library task with complete requirements and decisive local checks, do not force project discovery just to claim use. If no additional expertise is needed, call `catalog-route --file task.json` with a compact task like:

```json
{"operations":[{"intent":"Fix the known boundary bug"}],"external_help":{"needed":false,"reason":"Existing implementation and explicit boundary tests suffice","checks":["Run boundary and invalid-input tests"]}}
```

This records `direct_work` without a catalog download. Complete the work and checks, and say no external project was used. The decision belongs to this agent, not a hidden classifier. If the user explicitly requires external project selection/comparison, or missing expertise could materially improve the result, continue with discovery. Rejecting a weak shortlist does not require an open-ended search for something to use.

## Route the current task

In this conversation, use the user's intent, constraints and stack to write one compact operation per distinct need. Summarize the keywords once, mapping Korean or other languages to public English terms where useful. Reuse that task file unless the scope changes. Keep private prompts, source code and secrets out of search terms. This agent handles semantic matching and selection. The CLI and catalog service use no LLM, separate model or LLM API key.

Run `catalog-route --file task.json` for a compact shortlist. Read the [catalog request guide](references/catalog.md#request-path) for the task schema and cache behavior. Use `catalog-detail --trace TRACE_ID ID [ID ...]` to check the candidates you need together. Check fit, license, inputs, outputs and constraints against the pinned evidence. Term relevance is a retrieval signal. Decline weak matches and disclose missing catalog coverage.

For each chosen skill, read the pinned entrypoint with `read REPO --ref COMMIT --file PATH --text`. Read individual supporting files only when needed. For long reference documents, use `read REPO --ref COMMIT --file PATH --find "literal term" --context 8 --limit 3` to return bounded, line-numbered excerpts; do not use excerpts as a substitute for reading a selected skill’s full entrypoint. Prepare the selected bundle if it needs runnable resources or a local directory layout. Apply the guidance to the existing work, verify against the user's criteria and record the outcome with `catalog-record`. Warm routes and trace details work offline. Leave collection and finite profile review to the operator workflow.

## Discover when the catalog lacks coverage

Use `discover "public keywords"` for task-related GitHub search and observed Trending. Inspect `repo owner/repo` and read the relevant docs or source at the returned commit. Check the actual operation, output, stack, dependencies and license. Use observed recent momentum as a preference among compatible projects. Report unavailable Trending data.

[General GitHub workflow](references/oss-workflow.md) covers pinned checkout, integration and verification receipts. [Community-skill operations](references/operations.md) covers `search`, `inspect` and `prepare`. Inspect before running third-party code and follow the task's permissions. Apply the selected project and check the result before reporting it as used.
