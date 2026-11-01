# Product purpose

The user's explicit purpose, reaffirmed on 2026-11-07:
Find trending GitHub open-source projects appropriate to the user's current task,
and actually use them to improve the task's result.

- Start from the user's task, intended output, constraints, and environment.
- Consider relevant GitHub open source broadly: libraries, CLI tools, frameworks,
  agents, skills, and MCP servers. Do not redefine the product as only a skill
  directory or a design/frontend tool.
- Use popularity and recent momentum to discover candidates; verify task fit,
  documented capabilities, license, and practical integration before selecting.
  Keep stars, installation counts, and trending signals distinct.
- Continue through actual application and task verification. A recommendation
  list, download, or prepared bundle alone is not successful task completion.
- Reuse suitable known tools and cached evidence where appropriate. Do not add
  tools, dependencies, or a fresh remote search when they do not benefit the task.
- Treat caching, skills, MCP, ranking, and marketing as supporting mechanisms.
  Evaluate proposed features by their contribution to task-relevant discovery,
  appropriate application, and better task outcomes.
- State implementation boundaries honestly: v0.2 supports GitHub discovery, observed Trending, pinned source inspection/acquisition,
  and host-authored task execution with verification receipts, alongside community
  skills. It does not autonomously provision every dependency/MCP or prove universal
  task-quality superiority.

See docs/product-purpose.html for the canonical product definition.

## Caller-owned reasoning and token budget

- Intent interpretation, semantic matching, final skill selection, and synthesis belong to the calling agent's existing conversation. Do not add an internal LLM client, request the caller's API key, or forward a session/OAuth credential to the catalog service.
- The operator pipeline collects and stores data without LLM calls. Any semantic review is a finite task in an authorized local agent session, keyed to source evidence/version.
- Default tool responses should be small decision packets. Retrieve detailed evidence and supporting instructions only for candidates the caller needs; preserve source/version and explicit detail retrieval.
- Measure output tokens on the same catalog and multiple tasks before claiming savings. Tokenizer counts are estimates for a particular encoding, not the caller's billed tokens or proof of better task outcomes.
