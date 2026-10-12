# Task 5 — whole-branch integration review

Reviewed base `744faa918f1525296194af2842ba0f8d5ea54025` → frozen head `11dc544a06335a1c98650ffa51b17260132883de`. Read-only review; no subagents. **Specification verdict: needs fixes. Quality verdict: needs fixes.** Prior task approvals do not close the cross-workflow issues below.

## Strengths

- The active server and both entry points use the authenticated domain implementation. The anonymous state writer, prototype data and local medical-answer helpers are absent from the active import graph. Desktop and phone share the same domain client while retaining their separate shells.
- Source acceptance, immutable quotations, proposed changes, explicit user confirmation and derived results are distinct durable objects. `domain-store.mjs:107–123` repeats candidate validation inside the confirmation transaction and atomically records revisions, audit, receipts and continuation. It does **not** need a second, separate confirmation validator to fix the time defect.
- Owner identity comes from a server session; HTTP writes require Origin, CSRF and the captured epoch. The post-parse/PDF epoch check is inside the acceptance transaction. Matching committed receipts precede epoch CAS, whereas unknown old writes cannot adopt a new epoch. The client preserves the original request key/body/epoch and distinguishes opaque deletion recovery from health-body journals.
- The real AGH path is substantial: public Host/local endpoint/SDK, actual trusted package installation and pinning, three explicit-root Skills, exactly five tools, provider/request checks, private session binding, per-effect authority checks, ledger/argument/receipt correlation and separate replay invocation versus effect accounting. The per-run connection lifecycle closes the SDK, endpoint and Host; startup publishes only a ready runtime. Fixtures are labeled as fixtures.
- W2 requires the current concern to be rendered, rather than merely attached as unused evidence. W3 requires every distinct confirmed instruction text and exact revision reference to appear in the tasks. Source-only claims, stale cards, execution errors and incomplete deletion remain visible in the UI.
- Fault tests exercise actual SQLite rollback and contention, process SIGKILL checkpoints, owner-isolated router requests, asynchronous PDF/epoch barriers, genuine SDK scripted-provider execution, and client lost-response/reload behavior. The quality archive keeps first-stage failures, repaired output and unsuccessful workflows in their respective denominators.

## Issues

### Critical (Must Fix)

None established. These findings do not demonstrate cross-owner disclosure, unauthorized formal-fact creation, or an added clinical treatment decision.

### Important (Should Fix)

#### T5-I1 [P2] Explicit source time can disappear from candidate metadata and downstream schedule handling

**Locations:** `services/api/source-validation.mjs:37–40`; `services/api/domain-store.mjs:193`; `agents/runtime/skills/post-visit/SKILL.md:6,12`; downstream `services/api/domain-store.mjs:178`.

The unknown-time branch accepts `raw:null` for any otherwise valid quoted sentence. Therefore an exact quote containing `每日`, `三天后`, or an explicit date can be staged and confirmed while its displayed time is “未知 / 未记录.” Root's genuine W3 acceptance observed both omissions and correctly stopped before confirmation. The archived D09/D11/D12/H12 rows independently show the same class of omission. Manual correction always constructs unknown/null time, so it reproduces the defect without a model (`三天后记录症状。` was accepted with all time values null). The W3 Skill also gives conflicting rules: line 6 defaults to null unless there is a full date, while line 12 requires literal relative-time preservation.

The downstream schedule validator has an additional finite-language inconsistency: a confirmed `Record symptoms daily.` with `effective_time.raw='daily'` rejects `schedule:'daily'` but accepts `schedule:null`. H12's two English schedules are both null, including `after three days`; D09/D11 also retain null daily schedules. The full task text remains intact, which limits severity, but the separate time display is misleading and a correct literal schedule can be rejected.

**Fix:** establish one bounded, mechanical source-time policy for explicit literal cues, expose useful source annotations to the tool, and use the same preservation rules in staging, manual change construction and the applicable schedule check. Preserve the whole relevant raw phrase, including ambiguity/qualifiers; never infer calendar dates, frequency thresholds or clinical meaning. Unknown or malformed/non-normalized dates must be representable as verbatim raw text with null endpoints rather than forced into valid dates. Remove the contradictory Skill rule. Existing `confirm` revalidation must reject old stored violating proposals atomically; the existing explicit saved-source reanalysis path can regenerate them. Add focused stage/old-confirm/manual-change/schedule tests, including Chinese and the English literals already in the evaluation. Do not silently repair a model proposal into a different proposal at confirmation.

#### T5-I2 [P2] Manual corrections use a different marker classifier from the validator and reject ordinary user text

**Locations:** `services/api/domain-store.mjs:191–194`, especially `:193`; `services/api/source-validation.mjs:24–31`.

`changeRequest` derives assertion/temporal labels using narrower independent regexes, then immediately validates them using another set. In isolated actual-store checks, corrections `无头痛。`, `曾头痛。`, `No headache.` and `Previously headache.` all returned `INVALID_AGENT_OUTPUT`: the generated labels were affirmed/unknown but the validator required negated/past. The transaction rolls back the new source and proposal. This is user-authored correction, so there is no model repair step; ordinary correction/retraction explanations can simply fail.

**Fix:** share the finite marker classification/validation policy between user-change construction and candidate validation, including the supported English forms. Keep user-authored corrections as `reported_text`; do not promote a correction into a clinical field or relax source evidence. Test the concrete mismatches and preserve the intended rejection of genuinely ambiguous or unsupported inputs. Coordinate time construction with T5-I1.

#### T5-I3 [P2] Revoked checkpoints remain permanently advertised as pending and offer actions that cannot succeed

**Locations:** `services/api/domain-store.mjs:55`, `:72`, `:186`, `:197`; guards at `:128–131`, `:143–145`; `packages/client/domain-ui.js:33,38–40,75`.

Cancellation and epoch changes cancel active runs but do not expire their pending fact changes. Three isolated reproductions—cancel a `needs_review` run, revoke then regrant consent, and delete a different source—each left `profile.pending_changes.length === 1` and the run cancelled. The visible pending/review buttons remain, but rejection returned `SCOPE_REVOKED` and reanalysis returned `RUN_NOT_REANALYSABLE`. Manual changes without a run are similarly left at a superseded consent/epoch. This creates durable, non-actionable pending entries and falsely suggests that checking the boxes can complete them.

**Fix:** in the same cancellation/scope-changing transaction, retire affected checkpoints with an explicit expired/cancelled reason and remove them from actionable pending projections. Render the terminal reason truthfully. Cover direct cancellation, revoke/regrant, unrelated-source deletion and pending manual changes. Preserve sources/history and reject late writes; this does not require silently reopening cancelled scopes or making ordinary `/retry` accept cancelled runs.

#### T5-I4 [P2] Source deletion removes fact-dependent results but leaves their runs pointing at missing artifacts

**Locations:** `services/api/domain-store.mjs:198–205`; client consumption `packages/client/domain-client.js:295–299`.

A W2 run may use a current confirmed fact retrieved through context without including that fact's original source in `run.source_ids` (its own concern is the primary source). Deletion identifies and removes the result through `dependencies.fact_id` at line 201, but only tombstones runs through the narrower direct-source predicate at line 203. Reproduction: confirm source A, generate a visit with its independent concern and a fact-A claim, then delete A. The result read returned `NOT_FOUND`; the visit run remained listed, `completed`, `deleted:false`, and retained the deleted `result_id`. Reading that run in the client fails while fetching its result; ordinary retry returns `RUN_NOT_RETRYABLE`. The concern source remains saved.

**Fix:** calculate the affected artifact/run graph before deleting rows and clear or tombstone indirect result/fact-change references transactionally. Preserve the surviving concern source and a truthful withdrawn/deleted-result status, with a deliberate recovery route if regeneration is offered. Test deletion of a fact dependency that is absent from the run's direct source list, then verify single-run/list/client polling and export contain no dangling artifact references. Do not retain deleted generated text to make polling succeed.

#### T5-I5 [P2] Routine fact confirmation can permanently disable all care tasks without a usable recovery action

**Locations:** `services/api/domain-store.mjs:117,158,185,190`; `:139–145`; `packages/client/domain-ui.js:69`.

Profile-wide stale invalidation is explicitly documented, so that conservative policy alone is not a newly invented spec violation. Its integrated user consequence is still a defect: after a care plan completes, confirming an unrelated W1 sentence makes every care task stale, although its instruction revision is unchanged. The UI disables status changes and tells the user to “重新整理,” but completed care runs cannot retry and completed document runs cannot reanalyse. An isolated check returned `STALE_DEPENDENCY`, `RUN_NOT_RETRYABLE` and `RUN_NOT_REANALYSABLE` for those paths while the original instruction stayed at revision 1. The only practical current workaround is duplicating/reconfirming the document. The frontend implementation report acknowledges this limitation, but acknowledgment does not provide the missing recovery.

**Fix:** either retain validity for care tasks whose exact instruction/source dependencies are unchanged, or provide an explicit authenticated, current-epoch/CAS/idempotent regeneration of the existing document's currently confirmed instructions, surfaced in both clients. If retaining conservative invalidation, the regeneration option must be usable without duplicating source or bypassing confirmation. Genuine changed/retracted/deleted dependencies must still invalidate old tasks, and regeneration must not silently restore obsolete task text/status.

#### T5-I6 [P2] Document confirmation bypasses queue admission limits for the continuation

**Location:** `services/api/domain-store.mjs:121` (compare admission at `:62`, `:147–148`, `:185`).

Acceptance, retry and reanalysis enforce global/per-user queue limits, but confirmation calls `newRun`/`queueRun` unconditionally. In an isolated store with both queue limits set to 1, a document checkpoint was staged, another entry filled the queue, and confirming the document raised the queued/running dispatch count from 1 to 2. Across owners this can exceed the global bound through already-staged reviews, independently of ordinary input admission.

**Fix:** apply one shared admission policy to every continuation creation. A rejected confirmation must leave facts, review, audit and receipt unchanged, or use a clearly specified durable deferred-continuation design with its own bound; do not commit facts and lose the continuation. Test a full global queue, a full owner queue, rollback and same-key recovery after capacity becomes available.

### Minor (Nice to Have)

- **T5-M1 [P3] Duplicate proposals for the same source span remain possible.** `services/api/domain-store.mjs:104` assigns a new candidate ID to every valid element. Archived H03 contains the same uncertain sentence/evidence twice, once as `reported_text` and once as `diagnosis`. Selecting both would create two separate facts with the same quote. The uncertainty and full text are preserved and root/model evaluation did not confirm this case, so this is a quality/extra-review problem rather than an established medical assertion escalation. Prefer one proposal per identical source span/value, or explicitly group competing classifications for selection; do not collapse genuinely repeated text at different source locations. Keep H03's historical strict failure in the archive.
- **T5-M2 [P3] Global action feedback outlives its context.** `packages/client/domain-ui.js:126,195–203` preserves `message` across canonical peer refreshes. Root observed an old “候选尚未成为正式事实” toast beside the correctly updated confirmed fact. Tie feedback to its run/revision/action or clear obsolete transient feedback after a relevant canonical change. Do not replace the canonical status with a generic success toast.
- **T5-M3 [P3] Dense reliability/security methods impede maintenance.** Examples: `services/api/domain-store.mjs:55,90,102–105,178,191–206`, `services/api/domain-server.mjs:53–71`, `scripts/evaluate-model.mjs:88–103`. Several independent guards, transitions and writes occupy one line, making omissions such as the lifecycle findings harder to audit. Format touched code and extract narrowly shared policy helpers without mass renaming or changing clinical/semantic rules merely for readability.
- **T5-M4 [P3] Frontend action map names nonexistent entry points.** `docs/backend/frontend-action-map.md:3` names `apps/web/src/main.js` and `apps/mobile/src/main.js`; the actual entries are `apps/web/src/app.js` and `apps/mobile/app.js`.

## Quality evidence and acceptance judgment

The committed v1 archive is historical evidence for its recorded execution/assets, not a passing score for the final fixed branch. Its explicit aggregate counts are: **24/24 sources preserved; 9/24 strict first-stage cases and 11/24 strict final cases; 21/24 successful primary SDK closures; 29/32 total successful closures; 8 completed care continuations; three guarded unknown workflows still counted as failed workflows.** Candidate source support **23/23** has a different denominator and a looser time test than strict correctness. It cannot erase the four literal time-slot omissions, duplicate H03 proposal, or three failed primary runs. Five other time-code disagreements are disclosed annotation differences, not evidence of invented calendar dates. Care scoring at `scripts/evaluate-model.mjs:30–33` checks literal support/coverage but accepts null schedules; its continuation-success count does not establish schedule completeness.

Root's browser report is separate genuine acceptance evidence: W1 phone-save/desktop-confirm/shared fact passed; W2 actual source-supported card passed; W3 extraction exposed the time defect and was **not confirmed**. PDF chooser automation did not upload a file and is **not** a PDF UI pass. Existing HTTP/Poppler evidence remains useful but does not substitute for that UI action.

After policy/Skill/asset changes, preserve the original frozen v1 dataset, raw archive and reported metrics unchanged. For any final-version quality claim, use a newly independent frozen 12-development + 12-heldout dataset, retain first-stage/repaired/failed denominators, and perform genuine root UI W1/W2/W3 acceptance. Do not tune on the previous heldout cases and relabel them unseen. Fixing finite source processing is not a clinical-rule approval.

## Review method and verification boundaries

- Reviewed the supplied Task5 brief/browser report, spec/plan/decisions, target contract, task implementation/fix reports, previous independent reviews, and whole-branch package inventory and thematic implementation/test/contract/evidence passes. Generated OpenAPI/schema and evaluation JSON were inspected by their structure, predicates, relevant rows and denominator logic; binary documents and historical development/evidence notes were not counted as application code. Inspected the active store/router/queue/PDF/runtime/client/rendering and evaluator paths against each other, rather than treating earlier review verdicts as proof.
- Current HEAD was verified as `11dc544a06335a1c98650ffa51b17260132883de`; tracked working tree was clean. No application code, tests, index, HEAD, branch, external account, runtime assets, browser session, service or shared SQLite database was changed. Only this requested report was written.
- Ran three focused Node heredoc checks against **fresh in-memory DomainStore instances**, using only synthetic text and no queue worker/model/network: (1) manual classifier/time mismatch, indirect W2 deletion and continuation queue admission; (2) literal English schedule rejection/null acceptance and stale-care recovery; (3) revoked checkpoint pending/action states. Each exited 0 and printed the observed codes/counts reported above. These checks filled specific gaps in existing coverage; they were not full-suite reruns. The known SQLite ExperimentalWarning occurred.
- Read the relevant existing regression assertions and implementation-reported results. No new claim that the whole test suite, live model evaluation or browser acceptance passed is made by this reviewer. Root owns the fresh final verification after the fix wave.

## Declined to judge

- Clinical correctness beyond finite extractive/marker checks, medical thresholds, diagnosis/treatment quality or emergency triage: no approved clinical rule package or expert validation; D01/D02 intentionally remain `not_configured`.
- OCR, audio/voice and generic medical-answer implementation: intentionally unsupported, accurately surfaced; not missing work in this plan.
- Replacing local synthetic authentication with an internet identity service: outside the explicitly opted-in localhost demonstration scope. The review still examined owner/session/CSRF boundaries of the implemented scheme.
- Guaranteed erasure of remote AGH traces, backups, SQLite/WAL/OS remnants, or the old anonymous prototype DB: deliberately unverified/outside current-user deletion, with `partial` disclosure; not treated as fully erased.
- Minimal invalidation of all W2 context dependencies: the conservative policy is documented. **Did not set aside its stale-care recovery consequence**; T5-I5 covers that concrete effect.
- General semantic interpretation of every possible time expression or multilingual medical sentence: outside a finite mechanical validator. T5-I1/I2 concern supported literal forms and inconsistent existing rules, not a demand for general medical NLP.
- Power-loss/disk-full durability, arbitrary malicious Poppler inputs, broad penetration testing, production-scale fairness/long-load/remote partition behavior and all upstream AGH internals: no evidence sufficient to certify those broader boundaries; existing focused tests and disclosed limits are not general guarantees.
- Native-device hardware, clipboard/print OS delivery and successful browser PDF-picker operation: not independently observed; no UI success inferred from transport tests.
- A numerical clinical/model-quality acceptance threshold: none was specified. The actual limited metrics and incomplete current W3 acceptance are reported without inventing a score threshold.

## Recommendations and assessment

Complete one focused fix wave for T5-I1–I6 with tests for the exact cross-workflow paths. Keep the time/marker policy shared, make invalidated objects terminal and discoverably recoverable where appropriate, and enforce admission transactionally. Scope subsequent re-review to those changes and their new integration consequences; root then runs the fresh final checks and truthful acceptance/evaluation registration.

**Ready to merge? No — with fixes and final verification required.** The branch has a sound authenticated transaction and genuine AGH foundation, but ordinary correction, cancellation, deletion and follow-up flows still have reproducible defects, and current genuine W3 time acceptance is incomplete. This verdict does not reopen the already-fixed prior task findings or authorize push/merge/deployment.
