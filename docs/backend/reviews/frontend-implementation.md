# Task 3 — authenticated dual native frontend integration

Status: DONE_WITH_CONCERNS. Active desktop and phone clients use the frozen authenticated domain API. Genuine Agnes browser integration remains the coordinator's validation step; this task's injected model tests and browser preview are explicitly fixture-only.

Local commit: `d3afb1d` — `feat: connect native clients to authenticated health domain`. Command-local identity `fancyouth <fancyouth123@fancyouthdeMacBook-Air.local>`. No push. No backend, runtime, contracts, scripts/start, package.json, README, or external AGH checkout modifications in this commit.

## Files and entry points

- `apps/web/src/app.js`: native desktop entry, imports only `mountDomainApp({mobile:false})`.
- `apps/mobile/app.js`: native phone entry, imports only `mountDomainApp({mobile:true})`.
- `apps/web/index.html`, `apps/mobile/index.html`: add shared evidence/auth CSS and remove nonexistent `/runtime-config.js` request; phone loader no longer logs arbitrary error content.
- `packages/client/domain-client.js`: authenticated transport, identity/CSRF/session epoch, local draft and unresolved request journal, guarded canonical reads, domain methods and checkpoint polling.
- `packages/client/domain-ui.js`: shared framework-free domain business views and interactions with distinct desktop sidebar/topbar/home grid vs phone status/header/scrolling screen/bottom navigation.
- `packages/client/presentation.js`: escaped candidate/evidence/claim rendering, Chinese patient-facing semantic labels, optional folded technical records, provenance-preserving card copy/print text.
- `packages/client/domain.css`: additive auth/evidence/print styles; existing native CSS, assets, logos, white/green themes retained.
- `tests/client/domain-client.test.mjs`: current-domain client tests via real HTTP/auth and isolated SQLite/loopback server.
- `tests/client/presentation.test.mjs`: evidence/escaping/self-report/stale-copy and primary-vs-folded diagnostics checks.
- `tests/client/pdf-fixture.mjs`: explicitly synthetic text-layer PDF helper.

Historical `packages/client/{api,data,state-client,chat,demo-data}.js` and `apps/mobile/store.js` remain for historical tests only. Neither active app imports them. Their old sample profile, local medical inference, canned assistant answers and whole-state writes do not participate in current UI behaviour. The historical shared-state test results are not counted as current frontend evidence.

## Implemented flows

1. Explicit account/password login; bootstrap `/api/me`; server username everywhere. No hardcoded product credentials or default patient/sample profile. Exact same-origin browser writes use session cookie and the CSRF token bound to that authenticated session. Every write rechecks current me; a new account/session cannot silently replace CSRF and receive the old draft.
2. Shared canonical projection from profile/timeline/tasks/consents plus authenticated read-only state for stored results. No PUT state. Source/fact/change/result/run/operation objects fetched through their owner-scoped APIs. All source, model and diagnostic text is HTML escaped.
3. Daily source first: `/entries` acceptance receipt means saved original, then queued/running/needs_review/blocked/failed/cancelled/interrupted/completed polling. Needs-review clearly remains a candidate checkpoint. Failure after staging displays an execution warning and does not certify real execution. Fixture provenance is visible; genuine runtime metadata is taken from nested `runtime.agh`, with IDs in folded details.
4. Full atomic candidate review: complete original, field, affirmation/negation/uncertainty, past/current/unknown scope, raw time and precision, null/unknown start/end, before/after, conflict list, actual proposal-ID checkbox, evidence quote, source version/page and exact UTF-16 range. Chinese semantics are primary; raw enum/UUID/range/session details are folded under `处理与定位记录`. Canonical source-entry episode association is supplied in review; correction retains the selected fact association. Base vs current profile revision is visible. Confirm submits selected actual IDs and expected base revision. Stale CAS preserves selection/drafts and exposes refresh, source reanalysis or explicit current-revision rejection.
5. Corrections/retractions append user-authored source and reviewed change request with expected fact version, instead of overwriting facts locally. Version-history UI reads actual `fact_revisions` from authorized export, including historical/retracted revisions and evidence.
6. W2 source-first visit preparation uses selected source IDs, server result claims/questions/unknowns and dependency validity. Source-only claims are labeled unreviewed user self-report or document text. Stale/current labels remain in the rendered, copied and printed material. No local official card editor changes model provenance. Generic medical questions receive an honest supported-workflow explanation and a record/consultation-material path; no diagnosis/treatment answer or local clinical regex is generated.
7. W3 submits actual PDF multipart `file` or pasted document text. File stays local until upload action, limits come from capabilities, absent PDF extractor is visibly disabled. Every document candidate is individually reviewed. Confirmation queues the separate continuation. Multiple persisted tasks show exact confirmed instruction refs, null/literal schedule, current/stale dependency and versioned execution status. Done means execution status, not recovery. Stale tasks cannot update.
8. Versioned analysis consent, account export, source/all deletion and true partial deletion layer receipts. Consent changes/source deletion invalidate polls and displayed cached evidence. All-data deletion clears local current-account health drafts/journal. No promise of permanent AGH/backups/remnant erasure. Department/triage/audio/OCR unavailable states are identical on both ends, with no medical threshold invention.
9. Form fields update per-account/session drafts on every input. GET/poll never supplies editor values; focused or unfocused dirty inputs survive rerender/error/conflict. Focus/selection and opened evidence/diagnostic disclosures survive ordinary rerenders. No health content is placed in URLs or client logs.

## Identity, recovery and journal behaviour

`DomainClient` accepts `{fetchImpl,storage,channel,pollMs,timeoutMs}` for browsers or independent HTTP test clients. Production native fetch is bound to globalThis/Window. Public state contains authenticated user plus canonical profile/timeline/tasks/consents/results/runs/capabilities; no formal state is persisted in browser storage.

Session identity uses actual owner ID plus SHA-256 fingerprint of session CSRF as the draft/journal storage epoch, without storing CSRF or password. Generation tickets prevent late GET/poll/model callbacks after logout, new login, source deletion or consent revocation. BroadcastChannel + storage event propagate identity/scope/data changes between tabs; current-me and consent-version checks protect reads/writes even without broadcast. Canonical refresh also detects vanished sources and clears cached run/evidence views.

Creation, confirmation/rejection, reanalysis/retry, corrections and deletion persist original payload+UUID idempotency key before network send. Unknown outcome blocks another operation in that workflow slot. Explicit recovery uses original payload/key; later text/selection edits remain separate drafts. Successful operations store receipt metadata without copied input body. Same-session page reload restores unknown operations without auto submitting. Logout/switch clears active drafts/projections and quarantines unresolved original journal under its original owner/session; it is never restored into a new account/session. All-data deletion removes current-account local journals across session epochs.

PDF journal persists exact name/type/size/binary SHA-256 and original key; live page retains original File. After reload the user must reselect the identical file, which is verified byte-for-byte by its binary hash before reuse of the original request. A different file cannot be sent under the original key. Unknown confirmation recovery reads the actual commit receipt and moves to the confirmed/rejected canonical workflow.

Methods: initialize/bootstrapIdentity/login/logout/refresh; setDraft/getDraft/clearDraftIf; createEntry/createDocument/createVisit; source/factChange/operation; confirm/reject/reanalyse/retryRun/changeFact; updateTask/setConsent/deleteData/exportData/cancelRun/pollRun; pendingOperations/retryOperation/invalidate/invalidateScope/dispose. No method accepts a browser owner override or formal whole-state payload.

## Fresh verification

- Final `node --test tests/client/domain-client.test.mjs tests/client/presentation.test.mjs`: exit 0, **19/19 passed**, 0 skips, duration 1487.358084 ms.
- `npm test` shared-worktree run: exit 0, **93 tests, 92 passed, 0 failed, 1 preexisting opt-in SDK-build skip**, duration 5019.535792 ms. Includes concurrently completed runtime work; not all 93 belong to this task. Later minor renderer/receipt-disclosure refinements received the final targeted and syntax checks above.
- Final `npm run check`: exit 0, **49 JavaScript modules** passed.
- Final `git diff --check -- apps packages/client tests/client`: exit 0.
- SQLite ExperimentalWarning remains visible; not treated as a failing test or hidden.

Meaningful red observations included missing shared client/presentation, binary hash collision when incorrectly hashing decoded PDF text, all-data draft retention, consent-revocation late poll acceptance, native browser fetch receiver failure, source-deletion cache retention without broadcast, and untranslated primary review semantics. Corresponding regressions then passed after correction.

HTTP suite covers two independent actual-auth clients; source visibility without automatic facts; stale confirm/reanalysis/reject; unknown create and confirm original-key replay without duplicates; edits during uncertainty; cross-account CSRF refusal; delayed GET invalidation; same-session reload; actual PDF multipart/page evidence + exact-file recovery; multiple care tasks + version conflict; blocked source preservation + retry; partial deletion receipt lookup; revocation/deletion late reads; broadcast logout; persisted active draft cleanup and unresolved journal retention.

## Browser inspection (synthetic fixture, not real Agnes)

Isolated loopback fixture preview: `http://127.0.0.1:4175`, disposable DB `/tmp/healththread-client-preview.sqlite`, fixture launcher `/tmp/healththread-client-preview.mjs`. Account used only for fixture validation: `client-preview` (no credentials in product). Native CUA tabs: desktop 1, phone 2. Preview was kept running for coordinator inspection.

Verified through visible UI: desktop login/authorization, source save→full exact review→checkbox→formal fact; phone shares authenticated account, pasted two-instruction medical source→two candidates→explicit confirmation→separate continuation→two persisted tasks→versioned done update; phone fact change makes existing desktop W2 card and medical tasks stale; desktop W2 claim shows unreviewed self-report; print view retains stale label/quote/source provenance; an unfocused dirty record draft survives navigating to settings, refreshing, and returning home. Both inspected browser error logs were empty after fixes.

Final screenshots:
- `/tmp/healththread-task3-screenshots/web-review-final.jpg` — patient-facing full evidence review with technical details folded.
- `/tmp/healththread-task3-screenshots/mobile-tasks-final.jpg` — distinct phone shell, multiple tasks, done-is-execution status and stale dependency warning.
- `/tmp/healththread-task3-screenshots/web-stale-print.jpg` — stale copied/printed provenance; captured before final folded-diagnostic wording refinement.
- Earlier layout captures: `web-review.jpg`, `mobile-home.jpg`, `mobile-tasks.jpg` in the same directory.

## Remaining limitations / review focus

- No genuine model execution claim from this task: browser and HTTP model outputs are labeled fixtures. Coordinator/Task 2 own true Agnes runs and final real-runtime browser integration.
- Frozen API has no owner run/document-history list endpoint. UI discovers runs from canonical pending changes/results plus this session's persisted acceptance/continuation receipts. A blocked historical run originating in a different browser/session has its immutable source visible in timeline and full run receipt in account export, but is not automatically listed in the current session's run panel. This is a contract discoverability limit, not synthetic success.
- Version-history read currently uses owner export because no dedicated fact-history endpoint exists; export may include bounded original PDFs, making this read heavier than a dedicated history endpoint. Export data is not cached in browser storage.
- Unknown PDF recovery after reload requires reselecting original bytes; browser does not persist the PDF blob in localStorage. Unknown journals from a terminated/changed session remain quarantined under their original epoch and are never silently replayed with a new CSRF. Account export/receipts support manual reconciliation; no key-search receipt endpoint exists.
- Consent/task PATCH routes lack idempotency receipts by the frozen contract. Expected versions and subsequent canonical reads reconcile uncertain PATCH outcomes; they cannot safely be represented as a newly minted create/confirm request.
- No arbitrary durable chat/conversation endpoint exists. Existing generic-answer and local fabricated conversation flows were removed from active actions. Home question draft offers the supported record/visit workflow with honest unavailable medical-answer explanation.
- Polling is bounded and visible; automatic background refresh runs every five seconds while visible. No sustained-load/battery/performance claim, automated visual regression suite, or native device hardware test was made.
- UI PDF acceptance was exercised by real multipart HTTP tests, not an automated OS file-picker browser upload. Clipboard/OS print dialog delivery and downloaded-file opening were not driven end-to-end; rendered copy/print text has provenance/stale tests and browser inspection.
- Stale completed care plans cannot rerun in place through the frozen API; UI disables stale task updates and directs users to current-source review/document workflow. No unsupported regeneration endpoint was invented.

## Fix round 1 / 5 — three Important findings, polling minor, scope-generation integration

Status: DONE_WITH_CONCERNS pending coordinator's scoped review and final genuine browser acceptance. Local fix commit `12f5829` — `fix: recover deletion and bind clients to scope epochs`. Only `packages/client/domain-client.js`, `packages/client/domain-ui.js`, `tests/client/domain-client.test.mjs` changed. No backend/runtime/contracts/start/package changes or push.

Read `.superpowers/sdd/plan/task-3-review.md` in full and verified each finding against current code. Initial real-HTTP regressions failed for recovered deletion effects, hidden deleted selections, historical discovery, and redundant canonical refresh. Subsequent focused red cases also exposed dropping the opaque delete recovery handle after fresh-me all-clear observation, downgrading epoch watermarks on old me responses, preserving an erased journal after a stale POST rejection, restarting exhausted history pages, and retaining another tab's old in-memory draft when the shared persisted watermark was already updated. Each received a green regression after its root-cause fix.

### Important 1 — central deletion completion and truthful recovery

- Completion now lives in `execute` for successful DELETE acceptance, covering normal `deleteData` and exact-key `retryOperation`. It applies scope invalidation, owner health cleanup, cross-tab notification, canonical refresh and an explicit `deletion` event carrying the actual backend layer receipt.
- UI consumes that event and recognizes `deletion_job_id` in generic recovery, showing settings' actual partial-delete receipt instead of treating a delete as a source/model run. A failed subsequent read never changes a known delete receipt back into an unknown mutation outcome.
- Full-delete cleanup removes owner health drafts/body journals across stored session epochs. Partial-source deletion preserves unrelated concern/record drafts and valid selections. Backend `all_clear_epoch` distinguishes an all-delete even when the source list was already empty.
- Opaque unresolved DELETE recovery handles use separate `healththread-delete-recovery:<owner>:<session-hash>` storage. They contain only original operation UUID/key, opaque target path, owner/session/expected scope metadata, state and empty body. No health input body is retained in this handle. Thus observing the new all-clear epoch clears all health content while preserving the original delete key needed to recover its committed receipt. Completion removes the handle. It cannot acquire another account's CSRF/session.
- Repeated receipt recovery does not clear post-deletion new drafts in a peer that already observed the same all-clear counter. Per-tab observation drives memory cleanup; per-owner persisted maxima prevent old responses from lowering watermarks.

### Important 2 — deleted source selection reconciliation

- Partial local deletion and scope broadcasts remove the deleted source selection immediately. Canonical refresh always filters `selectedSources` against actually owned timeline sources, preserving concern text and all surviving IDs. UI reports the number removed.
- Visit creation refreshes and checks the original generation before submission, then sends only surviving requested source IDs. It never mutates an unknown request's frozen payload/key during recovery.
- Tests cover local and peer deletion with no BroadcastChannel, preserved concern/record inputs, remaining valid selection, and a successful subsequent visit request.

### Important 3 — historical work discovery

- Canonical refresh now reads owner-authenticated `GET /api/runs?limit=100` and `/api/documents?limit=100`, consuming `{runs,next_cursor}` / `{documents,next_cursor}`. Fresh login can display blocked/interrupted sources, their saved receipts/status/retry controls, and canonical document names/media/pages without a local acceptance journal or export lookup.
- Explicit “读取更早的任务 / 病历” controls use the opaque `before` cursor. Pages remain bounded at 100 and older explicitly loaded rows survive ordinary refresh while their sources remain owned. Exhausted cursors do not restart merely because the first page refreshes. No automatic unbounded pagination loop.
- This resolves the original report's owner-run/document discoverability limitation; dedicated fact-history still uses authorized export as previously reported.

### Polling minor — settled history and coalesced projection

- Simultaneous canonical refresh calls share one generation-bound in-flight batch. A batch guards identity/scope before and after its eight projections, rather than repeating a full set of identity/consent guards for each projection.
- Settled run reads cache an actual fetched checkpoint by status/phase/error/runtime/reference signature. An explicit status control forces a new run read. UI owner catalog already provides terminal status/receipt/provenance; discovery watches only queued/running work and does not loop over terminal history. Active checkpoint refreshes coalesce through the same client batch.
- Test verifies three concurrent refresh requests produce one profile GET and repeated settled lookup produces neither another run GET nor a whole profile refresh. A 101-document/run fixture verifies capped pagination, stable loaded history and no exhausted-cursor reset.

### Newly frozen server epoch contract

- Login/me provide `scope_epoch` (positive integer) and `all_clear_epoch` (starts zero, increases only for all-delete); successful authenticated responses also supply `X-HealthThread-Epoch` / `X-HealthThread-All-Clear-Epoch`.
- Every client business mutation uses `X-HealthThread-Epoch` captured with the original operation. Logout follows its explicit contract exception. Missing scope fails closed. Unknown operation recovery never substitutes the current scope into the original header/key/body. Matching immutable server receipts may replay before the epoch CAS; an uncommitted old write is rejected, and erased-source acceptance cannot resurrect.
- Scope changes preserve unrelated drafts but invalidate old callbacks/cache. All-clear changes purge owner health content even for empty sources and without broadcast. Epoch watermarks are monotonic per owner; stale successful me responses are ignored with `STALE_SCOPE`, without lowering counters or clearing newly written post-deletion drafts.
- File hashing and visit refresh retain the initiating ticket, so asynchronous preparation cannot silently capture a newer scope and submit pre-clear input. A stale mutation rejection immediately reads current identity/epoch and applies all-clear cleanup; it does not leave an erased old health body in the journal until the next timer.

### Fresh tests and checks

- `node --test tests/client/domain-client.test.mjs tests/client/presentation.test.mjs`: exit 0, **30/30 passed**, no skips, duration 2373.663084 ms.
- `npm test`: exit 0, **116 tests, 115 passed, 0 failed, 1 preexisting opt-in SDK-build skip**, duration 12357.562792 ms. Includes concurrently completed Task 2 review fixes; current client evidence is the focused 30 above.
- `npm run check`: exit 0, **53 JavaScript modules** passed.
- `git diff --check -- packages/client tests/client`: exit 0.
- SQLite ExperimentalWarning remains disclosed.

Focused genuine HTTP cases include: DELETE commit/response loss→original-key recovery; response loss→fresh me sees all-clear→health bodies gone but opaque delete handle survives→actual partial receipt; recovered delete broadcasts to a peer with a held old source response and that late read cannot reinsert views; local/peer partial-delete selection pruning; all-delete with already-empty sources and no broadcast; shared-storage persisted watermark plus stale in-memory peer draft; delayed older successful me; paused old POST arriving after all-delete with its original epoch header and actual backend 409; new login historical blocked/interrupted/document discovery; and capped 101-item pagination.

No fresh browser/model call was made in this fix round. Initial native-shell screenshots remain layout evidence, not proof of the new epoch/recovery code. Coordinator owns final live browser acceptance after all gates. The earlier preview process PID 14715 was no longer running when checked; final inspection should use the coordinator's current service rather than an old fixture process loaded before the new epoch contract.

## Fix round 2 / 5 — preserve opaque DELETE recovery during fresh-client bootstrap

Status: narrow reload-ordering finding addressed, pending scoped re-review. Local commit `03af5b2` — `fix: preserve opaque deletion recovery across reload`. Scope: only `packages/client/domain-client.js` and `tests/client/domain-client.test.mjs`; no backend/runtime/UI/contracts/docs changes, no push, subagents, model or browser calls.

Read `.superpowers/sdd/plan/task-3-rereview-1.md`. The original three Important findings and polling minor remain closed by round 1; this round handles only its new Important reload regression.

Root cause: a fresh `DomainClient` had no in-memory operations when `bootstrapIdentity` observed a newer all-clear epoch. `clearLocalHealth` therefore preserved an empty list, and `persistDeletionHandles` removed the existing same-session opaque key before full restore. The earlier same-instance fresh-me test could not cover this ordering.

Fix: after authoritative me/login has established actual owner, CSRF and session hash, load only that owner/session's opaque DELETE handles before observing the scope watermark. The helper uses the existing handle projection, retaining empty body and original operation key/target/expected epoch, and filters owner/session identity. Health drafts/body journals remain unread until all-clear processing completes. Full restore follows the existing monotonic epoch check and cleanup. No scope/CSRF substitution or copied health body restoration occurs.

Meaningful real-HTTP RED: create saved source and local/other-session health text → DELETE commits but response transport is lost → dispose old client → new client sharing same storage/session → initialize. The new regression failed at `reload must preserve the original opaque recovery handle before all-clear cleanup` with no handle present. GREEN verifies no draft appeared during bootstrap events, all health body journals were removed, original owner/session/key/expected scope survive only in the opaque empty-body handle, current scope is newer, retry sends the original epoch header, response equals the actual committed partial receipt, clear counter stays one (no duplicate deletion), and the handle is removed after recovery.

Fresh verification:
- `node --test tests/client/domain-client.test.mjs tests/client/presentation.test.mjs`: exit 0, **31/31 passed**, no skips, duration 2380.527833 ms.
- `node --check packages/client/domain-client.js` and `node --check tests/client/domain-client.test.mjs`: exit 0.
- `git diff --check -- packages/client tests/client`: exit 0.
- No unnecessary full-suite/model/browser run for this small change, as directed. SQLite ExperimentalWarning remains disclosed.
