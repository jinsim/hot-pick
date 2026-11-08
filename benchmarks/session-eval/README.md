# Independent session evaluation

This harness runs actual authenticated Codex CLI sessions. It consumes the caller's existing Codex allowance; it is **not** a zero-token unit test or a scheduled collector. No model API key is requested. Run only when intentionally evaluating agent behavior.

Prerequisites: `codex` already signed in, Python 3, Node.js, Chrome, and Playwright available to Node. The existing user's model/reasoning configuration is used without overrides. Do not run the harness concurrently with another evaluation in the same checkout.

- `run.py`: three tasks × baseline/treatment, separate processes and directories, sequential alternating arm order, 480-second process bound. Writes raw/private JSONL and usage under ignored `.research/session-eval`.
- `extraction.py`: a fourth dependency-allowed task pair. Before running, place the chosen baseline skill tree at `.research/session-eval/pinned-hot-pick` using `git archive BASELINE_REF skills/hot-pick` and preserve its hashes. This pair waits for the first six runs and uses that frozen tree.
- `validate.py`: independent, predeclared behavioral grading. Set `PLAYWRIGHT_MODULE` to an installed Playwright module path if it is not locally resolvable. `browser-check.mjs` requires Chrome. An extraction task-local `.venv` is reused for its installed dependency.
- `rerun.py money-csv pagination keyboard-form`: new treatment sessions after an explicitly identified source change. Uses **identical prior request text**, new seeds/cache directories, and refuses to overwrite an existing improved run.
- `report.py`: publishes sanitized aggregate receipts and selected produced artifacts under `docs/session-evaluation.*` and `artifacts/`. It does not publish raw session logs, credentials, or full downloaded skill sources.

A normal sequence is `python3 run.py`, then `python3 extraction.py`, then `python3 validate.py`. Apply and verify the intended product changes before `python3 rerun.py ...`; grade again and run `python3 report.py`.

Review prompts, fixtures, and graders before launching. The original experiment recorded 2026-11-11 timestamps and the actual default model; later replays are not the same experiment. One run per arm/task is insufficient for statistical generalization. Baseline forbids skill invocation, not ordinary code/dependency use. Treatment allows rejecting unsuitable candidates. The fourth task permits dependencies in both arms.

Input tokens include the cached-input subset; do not add them twice. Report provider usage fields without inferring dollar costs. Session wall time includes startup and the agent's own verification. External grader time is separate. Warm provider/CDN caches and background load are uncontrolled. Output behavior checks are not a complete quality assessment.

Produced example artifacts are retained so negative results remain inspectable. HTML extraction's dependency versions are included when the agent used a virtual environment. No worktrees or persistent background runners are created.

A second, explicitly documented development retest used `HOT_PICK_EVAL_ARM=hot-pick-improved-batched python3 rerun.py keyboard-form` after generic verification-batching guidance was added. It retains the first UI regression and is not a fresh baseline replication.

`geometry-audit.mjs` is an explicitly post-hoc exploratory audit of all UI variants against the original seed at800/320px. It records exact bounding-box deltas without a new pass threshold and never changes the primary acceptance scores.

Disposition: the second revision’s experimental verification-batching guidance was rolled back after no overall measured benefit. Its measured source hashes and all results remain preserved. The first revision remains: direct-work gate, bounded source reads and description parsing. These sessions did not select the zero-network gate; UI overhead remains unresolved.

`verification-policy-experiment.txt` preserves the exact uncommitted second-revision skill text (SHA-256 `c13a410d0f3332bce89a0b7006f5bc39920679048c6a2a97891cadcb677d1406`) recovered from the session’s complete source read. It is an inert experimental snapshot, not an installable skill.
