# Task 1 re-review — fix round 1

Reviewed base `fc2a8f0` → head `03a6598` (`fix: bind rendered evidence and recover review dispatch failures`). Scope: the five open Important findings in `task-1-review.md` and new breakage introduced by this fix diff only.

**Assessment: all five Important findings ADDRESSED. No new Critical or Important regression established in this scoped re-review.**

## Finding verdicts

| Original finding | Verdict | Evidence at reviewed head |
| --- | --- | --- |
| 1. Candidate semantics borrowed from unrelated evidence | **ADDRESSED** | `services/api/source-validation.mjs:20` requires every validated quote to equal the rendered candidate value; `:23` makes that value the sole input to field/assertion/temporal/effective-time checks. Evidence remains nonempty and exact source/version/range/page checked (`:6`). Confirmation still repeats this validator inside its transaction (`services/api/domain-store.mjs:92`). The added mixed-evidence tests cover diagnosis, negation, past scope, and exact time. |
| 2. W2 completion without rendering the current concern | **ADDRESSED** | `services/api/domain-store.mjs:150` requires a current-concern quote equal to that claim's rendered text. `:152` requires every cited fact value and validated quote to equal the claim text, and `:155` requires speech to equal the rendered claim sequence. Unused concern evidence can no longer satisfy coverage. The regression rejects the laundered history claim without storing a result, then accepts separate rendered history and concern claims. |
| 3. One W3 task hiding multiple distinct instructions | **ADDRESSED** | `services/api/domain-store.mjs:158` requires every referenced instruction to have the rendered task text. `:159` checks completeness using text plus fact ID/revision. Distinct instructions therefore require their actual texts to appear; identical instruction texts can share one task with all corresponding references. Both cases are present in the added regression. |
| 4. Stale checkpoint stranded without saved-source recovery | **ADDRESSED** | `services/api/domain-store.mjs:104` adds explicit rejection using current profile CAS and current owner/consent/epoch, with no FactRevision or profile increment. `:119` adds transactional reanalysis: current CAS, owned pending review/run, consent/epoch, owned saved sources and queue limits are checked before the old run is cancelled and scope incremented, old change expired, and a fresh run/outbox/operation created from the same sources. `:89` continues to reject stale confirmation. `services/api/domain-server.mjs:58` exposes authenticated reanalysis and aborts the superseded local worker. Tests cover stale confirmation, stale rejection, wrong CAS/owner, idempotent replay/conflict, old callback refusal, preserved entry count, and successful fresh confirmation. |
| 5. SQLite claim failure escaping background dispatch | **ADDRESSED** | `services/api/domain-jobs.mjs:32` catches dispatch enumeration/claim/settlement failures, covering timer and microtask callers. `:13` applies finite exponential backoff and suspension with sanitized diagnostics; `:43` contains rejected execution promises and aborts their bound tools. Pending unknown effects settle as interrupted or preserve the checkpoint with an execution error (`:23`), rather than replaying the provider. Operator resume is explicit (`:51`); failed claims leave the transactional durable queue record intact. `services/api/domain-server.mjs:24` exposes dispatch state through health. Added real two-connection SQLite tests cover bounded attempts, queued source preservation, restart recovery, background timer containment, HTTP liveness, and explicit resume. |

## Regression and invariant inspection

- The fix adds no formal-fact write path. `confirm` remains the owner-scoped human action that validates the current profile and evidence and commits FactRevisions, audit, receipt, invalidation and continuation together. Reject and reanalyse do not create facts.
- Reanalysis mutations and its idempotency receipt share the existing `BEGIN IMMEDIATE` transaction. Failed validation rolls back; original source/entry/document rows are reused. The new run receives the current snapshot/consent/epoch and fresh scope/deadline, while old scope callbacks fail. Receipt replay also checks that the saved primary source still exists (`services/api/domain-store.mjs:46`).
- Existing bound-tool source ownership, consent version, user epoch, scope epoch and source existence rereads remain in place. The queue's added AbortSignal wrapper further refuses tool calls after worker abort (`services/api/domain-jobs.mjs:71`).
- The scheduler does not invent successful results or real runtime provenance on storage failure. Existing real adapter receipt correlation remains unchanged; the new recovery branches write operational error state only.
- Contract changes describe the stricter rendered-evidence rules, explicit stale-review recovery, bounded suspension/resume and health state. The new ReanalysisReceipt schema matches the runtime response fields.

## Deferred Minor / scope boundaries

- Carry forward the original Minor items: generic success schemas outside the new typed reanalysis receipt, dense formatting in prior domain methods, and the openly reported Node SQLite ExperimentalWarning. These are not reopened as blockers in this round.
- Genuine AGH SDK provenance/registration/session execution, client migrations and late-response behavior, model evaluation, and the original disclosed broader failure/load/erasure verification limits remain subsequent-task work. This review does not certify them.

## Review method and evidence limits

- Read the original review, brief, appended fix report, supplied review package, binding backend spec/target contract/rubric, all changed implementation/contract/test hunks, and the immediately relevant surrounding store/queue code. Recovered truncated tool output through smaller file/diff reads.
- Inspected the new regression assertions and accepted the implementer's reported verification: targeted 44/44 pass; full suite 63 total / 62 pass / 1 preexisting skip; final focused HTTP checks 2/2 pass. These are reported implementation results, not new executions by this reviewer.
- No full suite rerun and no additional reproduction was needed: inspection did not establish a concrete new untested risk requiring one under the assigned scope.
- No application source, tests, index, HEAD, branches, running service or remote resources changed. Only this requested report was written. Existing unrelated AGH worktree changes were left untouched.
