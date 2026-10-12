### Spec Compliance

- ❌ Issues found: the evaluation harness does not reliably preserve and summarize Core-rejected malformed W2/care proposals or case-level capture failures. `scripts/evaluate-model.mjs:24`, `:30`, `:67`, `:79` can throw or retain a case without its primary evidence; details below. This misses the requirement to retain structural failures and every case in the evaluation denominator.
- ✅ The reviewed `03af5b2..d8050cb` package contains the 23 authorized Task4 files. It adds independent faults, typed contracts, evaluation tooling/evidence and acceptance documentation; no production/domain/runtime/Skills/app behavior changes occur in this package. The separately frozen dataset remains the supplied `621be3f` dependency.
- ⚠️ Full branch correctness and genuine browser acceptance are coordinator gates, outside this Task4 diff (`docs/backend/runbook.md:50`). Root reports W1 passed and W2 actual source card completed; PDF chooser automation did not provide PDF UI evidence. Root's newly observed W3 normalized-time omission belongs to the later backend/final-review fix wave; this review does not grade unchanged backend marker validation.

### Strengths

- `tests/faults/crash.test.mjs:11` and `tests/fixtures/crash-worker.mjs:5` use actual SIGKILL after deterministic IPC barriers, including a kill inside the acceptance transaction. Assertions cover empty rollback, same-key durable receipt replay, running→interrupted, preserved review, and independently queued continuation; this is substantive process/SQLite evidence.
- `tests/faults/isolation.test.mjs:10` exercises the real router for foreign source/run/result/review/operation/task/confirm/delete/export/discovery and verifies owner data remains intact. The audit trigger at `:23` verifies facts/profile/review/receipt/result/task rollback, followed by successful recovery and invalidation at `:25`.
- `tests/fixtures/pdf-boundary-worker.mjs:21` pauses extraction, commits all-delete through the actual handler, then verifies 409 and no recreated source/document/run; `:28` verifies temporary-directory cleanup. `tests/faults/pdf.test.mjs:10` separately uses genuine Poppler for encrypted/no-text/corrupt/two-page inputs. Timeout/cancel dependency simulation is accurately disclosed (`docs/backend/fault-matrix.md:22`).
- `contracts/openapi.yaml:3634`, `:3872`, `:4458`, `:4721` provide concrete profile/result/runtime/export schemas, including kind-conditioned payloads and bounded `trace_erasure:unverified`. `tests/faults/contracts.test.mjs:23`, `:39`, `:43` validate actual workflow responses, compile success-response refs, and reject result-kind mismatch; no production schema-validation dependency was added.
- `scripts/evaluate-model.mjs:35` selects the earliest public SDK stage, including Core rejection; `tests/faults/evaluation.test.mjs:24` exercises this through genuine Host/SDK with a scripted provider. `docs/backend/validation.md:24` preserves D04/H03 structural failure in the case denominator and distinguishes genuine model evidence from scripted fixtures.
- The frozen dataset SHA matches `0e5b3d16a2badd3417ff77e2f5fdb9d6c058407fbbd4df7fd47f8d3542496b10`. The local raw archive hash matches the portable summary. Read-only archive/SQLite checks found 24 distinct cases, 32 distinct SDK sessions, 29 correlated successful closures, preserved input sources, matching persisted confirmed FactRevision refs, and no substitution of a later stage for the first raw stage (`docs/backend/evaluation-results.v1.json:7540`; `scripts/evaluate-model.mjs:78`).
- `docs/backend/validation.md:26`, `:30`, `:39`, `:43` disclose offline scoring correction, missing initial evaluator byte hash, distinct strict-gold/source-support denominators, three failed unknown workflows, four normalized time omissions and H03 duplication. The report does not claim clinical proof, model self-grading, or successful empty-artifact workflows for those failures. Gold and model outputs were not changed to improve the scores.

### Issues

#### Critical (Must Fix)

- None found in the Task4-owned package.

#### Important (Should Fix)

- **[P2] Structural raw output can destroy evaluation bookkeeping.** `scripts/evaluate-model.mjs:24` reads `c.text` from every W2 claim and `:30` reads `task.instruction_refs` from every care task without guarding null/non-object elements. A valid JSON but Core-invalid first stage with `claims:[null]` or `tasks:[null]` therefore throws during scoring. `capture` has not returned when `runCase` catches the error at `:67`, so the saved row contains an error but loses its primary raw stage/SDK evidence. `summarizeEvidence` then dereferences the absent primary at `:80`; case failure before acceptance also breaks `:79`, and `summarizeFile` assumes acceptance/primary at `:100`. Treat malformed rows as structural failure, preserve captured evidence independently of scoring, and summarize partial/error cases with explicit failure denominators. Add focused regressions for null/non-object raw elements and missing acceptance/primary. No live model rerun is required; the current archived 24 cases are intact.

#### Minor (Nice to Have)

- **[P3] H05 repair explanation disagrees with its raw evidence.** `docs/backend/validation.md:63` says the first proposal omitted the original time qualifier. The preserved raw proposal already has the complete value/quote and `effective_time.raw:'大约两周前'`; its rejected `temporal_scope` is `past` (`docs/backend/evaluation-results.v1.json:4626`, `:4649`). The repaired version changes that label to `unknown` (`:4704`). Correct this table cell to describe the temporal-scope repair; aggregate metrics need no change.

### Checks and Limitations

- Read the supplied reviewer prompt, Task4 brief/report, `docs/backend/spec.md`, Task4/global constraints in `docs/backend/plan.md`, rubric, and scoped diff in passes. Frozen dataset and local original evidence/SQLite were inspected only as named dependencies for dataset integrity, first-stage selection and persisted task-reference evidence. No unrelated implementation review, services, index/HEAD mutations, subagents, full-suite/model/browser reruns occurred.
- Existing logs were read: `/tmp/healththread-task4-tests-final.log` records **145 total /144 pass /0 fail /1 skip**; `/tmp/healththread-task4-sdk-build.log` separately records **1/1 pass /0 skip**; fault log records **28/28 pass** and syntax/JSON check records **64 modules pass**. Known SQLiteExperimentalWarning remains disclosed; no pristine-output claim is made (`docs/backend/validation.md:3`, `:9`, `:14`).
- The only new focused execution imported the evaluator and called `scoreVisit` with `claims:[null]`, `scoreTasks` with `tasks:[null]`, and `summarizeEvidence` with a recorded case-level failure lacking primary. All three reproduced TypeError; it made no model calls or file writes.
- Once-only execution is supported by the frozen-before-run record, the single archived case/run set and unchanged runtime generation; this review does not establish an exhaustive external-provider history. Initial evaluator bytes were not captured, so exact historical evaluator-source reconstruction is unavailable and already disclosed (`docs/backend/validation.md:26`).
- External/OS deletion remnants, real Poppler hang, power loss/disk-full, long load/network partitions, complete penetration testing and clinical expert review remain explicitly unverified (`docs/backend/validation.md:76`). These disclosed boundaries are not promoted to passing tests.

### Assessment

**Task quality:** Needs fixes.

**Reasoning:** The current fault tests and archived evaluation provide concrete, appropriately limited evidence. Fix the evaluator's structural-failure/partial-case bookkeeping and the H05 explanation before approving this task; preserve the existing archive, frozen gold and model/runtime generation.
