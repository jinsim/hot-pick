---
name: Voluntary usage report
about: Report whether hot-pick helped a real task (public, opt-in)
title: '[Usage] task outcome'
---
Generate a small report locally, review it, then open its review_url:

`npm run hot-pick -- feedback --helpfulness improved --outcome completed`

Optionally add `--file /path/to/apply-receipt.json` to attach only check counts and a stable task ID. No receipt contents, prompts, paths, commands, or artifacts are uploaded. Use improved/same/worse/unknown and completed/failed/abandoned honestly. Reports from the owner, bots, tests, malformed reports, and duplicate account/task IDs are excluded. This is self-reported evidence, not independent quality verification.
