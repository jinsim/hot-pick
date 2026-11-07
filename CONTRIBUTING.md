# Contributing to hot-pick

The most useful contribution is a reproducible task where a selected open-source project improved the result—or failed to help.

1. Start with the task, constraints and expected output.
2. Record the selected project's public URL, license and commit.
3. Show actual application and independent checks. Separate lookup, preparation and task success.
4. Report cold/warm timing separately. Never infer billed tokens from characters or bytes.

Use [task results](https://github.com/jinsim/hot-pick/issues/new?template=task-result.yml) or [bug reports](https://github.com/jinsim/hot-pick/issues/new?template=bug.yml). Remove private prompts and credentials before sharing.

For code contributions, use Node.js 22+, keep the CLI dependency-free, and run `npm test`. Include a focused regression test for behavior changes. The collector must remain deterministic, free-only, and without LLM calls. Do not add telemetry or paid infrastructure implicitly.

Useful areas: small public task fixtures, ranking failure cases, host installation compatibility, and cold-catalog latency. New integrations should preserve pinned-source evidence and existing working examples.
