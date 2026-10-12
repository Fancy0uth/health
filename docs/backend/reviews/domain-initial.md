### Spec Compliance

- ❌ Issues found. Task 1 does not yet meet I03/E10 source-support semantics, W2 current-concern completeness, E22 multi-instruction completion, E11 saved-source conflict recovery, or E04 bounded database-failure handling. Five Important findings below were reproduced against the reviewed implementation.
- ⚠️ Cannot verify from this diff: genuine AGH SDK provenance/registry/session trace, the two client migrations and browser late-response behavior, or 12+12 real-model evaluation. These are explicitly subsequent tasks, not failures of this task. The boundary is documented in `contracts/README.md:25` and `docs/backend/progress.md:18`; `domain-jobs.mjs:15` validates adapter metadata shape/receipt correlation, not SDK provenance.
- ⚠️ No claim of full E01–E22 verification: real process death mid-commit, encrypted/timeout PDF fixtures, teardown of a hanging real adapter, load/fairness, and external erasure remain unproven by this diff/report. The implementer correctly disclosed these limitations.

### Strengths

- `services/api/domain-store.mjs:20` and `:46`: input immutability triggers and request-hash receipts provide concrete storage constraints; source/entry/document/run/dispatch acceptance shares one SQLite transaction.
- `services/api/domain-store.mjs:87`: confirmation places version checks, new FactRevisions, audit, operation receipt, invalidation and W3 continuation in one transaction. `tests/domain/store.test.mjs` adds an injected audit-insert failure and asserts rollback, not merely a mocked response.
- `services/api/domain-store.mjs:66` and `:69`: bound tools reread durable consent/epoch/ownership/scope; checkpoint replay is also checked. `services/api/domain-server.mjs:29` resolves ownership from the session and enforces CSRF; `:65` contains a realpath-based static allowlist.
- `services/api/pdf.mjs:14`: argument-array subprocess extraction has bounded output/time and temporary cleanup; `services/api/domain-store.mjs:153` honestly returns partial erasure with unverified external layers.

### Issues

#### Critical (Must Fix)

- None established in this task-scoped review.

#### Important (Should Fix)

1. **Candidate semantics can be borrowed from unrelated evidence.** `services/api/source-validation.mjs:22`, `:26`, `:32`. The value need only equal one evidence quote, but field, assertion and temporal checks run over the concatenation of every quote. Reproduction: source `头痛。诊断肺炎。`, value `头痛。`, field `diagnosis`, and both exact sentence quotes passes `validateCandidate`. Thus the diagnosis field is accepted although its value's sentence contains no diagnosis; the same construction can change assertion/time by appending another sentence. Confirmation calls this same validator (`services/api/domain-store.mjs:92`), so human selection does not restore the promised server support check. Bind field/assertion/time to the quote that actually supplies the value; reject auxiliary evidence that changes those semantics. Add mixed-evidence negative cases.

2. **W2 can complete without expressing the current concern.** `services/api/domain-store.mjs:117` and `:119`. Presence of a concern-source ID anywhere in claim evidence satisfies the concern requirement, while claim text may equal another quote. Reproduction: history `旧记录。`, concern `新困扰。`, one claim with text `旧记录。` and both evidence quotes produces a completed result with speech only `旧记录。`. Require a rendered claim whose text is supported by the current concern itself; attaching unused evidence must not satisfy coverage. This bypasses the intent of the existing history-only rejection test.

3. **One W3 task can hide multiple confirmed instructions.** `services/api/domain-store.mjs:125` and `:126`. A task text must match only one referenced instruction, and completeness is checked only by membership in `instruction_refs`. Reproduction: confirm `请记录体温。` and `请带检查报告。`, then submit one task with the first text and both references. Staging succeeds and stores only the first task. Require every confirmed instruction's actual text/action to be represented, or constrain each extractive task to the instruction it renders; do not count an unused reference as a fulfilled instruction. Preserve support for genuine identical instructions without dropping distinct actions.

4. **A stale review checkpoint has no saved-source recovery path.** `services/api/domain-store.mjs:89`, `:104`, `:132`. After staging two submissions at the same revision and confirming the first, the second cannot confirm even with the latest expected profile revision because its immutable base remains old. Reject delegates to the same check and also fails. Retry rejects `needs_review`; cancelling changes it to another non-retryable state. Reproduction returned `REVISION_CONFLICT` for confirm/reject and `RUN_NOT_RETRYABLE` before and after cancel. The original source is saved but unusable for a fresh review without duplicating submission. Add an explicit safe rebase/reanalysis path from existing source (with new run/epoch and CAS), and permit a well-defined rejection of stale proposals; keep stale confirmation itself blocked.

5. **Database lock failure escapes background dispatch and can terminate the service.** `services/api/domain-jobs.mjs:4` and `:5`; `services/api/domain-store.mjs:64`. Both the interval and queued microtask call `kick()` without an exception boundary; `claimRun()` can throw before `execute()`'s catch exists. A focused real SQLite reproduction held `BEGIN IMMEDIATE` from another connection, shortened the isolated test connection's busy timeout, and observed `ERR_SQLITE_ERROR: database is locked` escape `jobs.kick()`. In its timer/microtask call site this is an uncaught exception, rather than an E04 recoverable failure. Catch scheduling/claim failures, preserve the durable queued record, apply bounded retry/backoff, and emit a sanitized operational error. Add a focused contention regression proving the server remains alive and the accepted source remains recoverable.

#### Minor (Nice to Have)

- `contracts/openapi.yaml:196` and `:1014`: success schemas are generic `{type:'object'}` throughout, so the advertised frozen OpenAPI cannot validate acceptance receipts, commit receipts, run state or result shapes. README descriptions help human integration but do not replace field/required/enum response schemas. Add shared response definitions consistent with the runtime.
- `services/api/domain-store.mjs:67`, `:106` and `services/api/domain-server.mjs:42`: newly added domain/security logic is compressed into very long physical lines with many independent checks and writes. Format it and separate validation/transition helpers so future source/epoch/transaction reviews can identify individual branches reliably.
- `services/api/domain-store.mjs:1`: the implementer's reported suite and the focused reproductions emit Node's SQLite ExperimentalWarning. This is accurately disclosed and not a failed test, but the verification output is not pristine; retain it as a known runtime dependency warning rather than claiming noise-free checks.

### Focused checks and review scope

- Read the supplied full diff in sequential chunks. The initial combined tool output was truncated, so only the missing initial OpenAPI range was recovered. No changed source file was separately read, no broader codebase crawl or git commands were used.
- Ran three focused Node stdin scripts only: (a) candidate evidence borrowing, omitted W3 instruction, stale-review lifecycle; (b) real two-connection SQLite lock at queue claim; (c) W2 concern evidence laundering. All demonstrated the reported behavior. Databases were in memory or a cleaned temporary directory. No full suite was rerun.
- No source code, index, HEAD, branch, service process, model runtime or remote resource was changed. Only this requested review report was written.

### Assessment

**Task quality: Needs fixes.**

The central identity and transactional design is substantial and mostly explicit, but the reproduced validation bypasses can mislabel/omit user information, stale checkpoints strand saved work, and a routine storage contention path escapes the scheduler. Fix these before integrating the real model/client workflows; the existing green suite does not cover these counterexamples.
