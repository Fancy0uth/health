# Task 3 review — spec compliance and code quality

## Spec Compliance

- ❌ Issues found. The reviewed `03a6598..d3afb1d` implementation covers the primary authenticated W1/W2/W3 flows, but recovered deletion does not perform the required local cleanup, deleted source selections can block subsequent visits, and historical blocked/interrupted runs remain undiscoverable from another session. See Important findings below.
- ⚠️ This is a Task 3 review of the provided review package, not approval of Task 2 runtime code included in the same range. The coordinator has ordered additive authenticated run/document discovery; that change is not implemented in the reviewed client and is not assumed fixed here.
- ⚠️ Genuine Agnes execution and final browser acceptance remain coordinator work. The implementer explicitly reports fixture-only HTTP/browser evidence. Real PDF picker interaction, OS clipboard/print delivery, downloaded-export opening, and native-device keyboard/layout behavior are not verified here.

## Strengths

- Both active entry points now import only the domain UI (`apps/web/src/app.js:1`, `apps/mobile/app.js:1`); the shared renderer still selects distinct desktop sidebar/topbar and phone header/scroll/bottom-navigation shells (`packages/client/domain-ui.js:99`). Existing theme/asset stylesheets remain loaded in both HTML entry points. Old sample identity, canned medical responses, and whole-state writes are absent from the active import graph visible in the diff.
- Session-bound draft/journal keys, CSRF checks, generation invalidation, current-me checks, and consent checks are explicit (`packages/client/domain-client.js:41`, `:61`, `:104`, `:108`, `:112`). Resolved persisted journals omit copied request bodies; unresolved writes retain original keys/payloads and PDF retries check binary fingerprints (`:44`, `:129`, `:151`).
- Candidate review preserves full sentences, semantics, exact evidence, actual proposal IDs, explicit selection, and CAS revision (`packages/client/domain-ui.js:71`, `:150`; `packages/client/presentation.js:16`). Source-only claims and copied stale cards remain labeled; runtime errors and fixtures are distinguished (`packages/client/presentation.js:21`, `:29`; `packages/client/domain-ui.js:35`).
- The added HTTP tests exercise real authenticated API requests with isolated SQLite data, two client instances, unknown create/confirm outcomes, delayed reads, PDF recovery, and multiple versioned tasks (`tests/client/domain-client.test.mjs:25`, `:38`, `:44`, `:75`, `:109`). They explicitly inject a synthetic model rather than claiming real model-quality evidence (`:13`).

## Issues

### Critical (Must Fix)

- None identified within the reviewed Task 3 scope.

### Important (Should Fix)

1. **Recovered deletion skips cleanup and scope invalidation.** `packages/client/domain-client.js:151` returns `execute()` directly for recovery, whereas all-data draft/journal cleanup, cross-tab scope broadcast, and cache invalidation exist only after the original `deleteData()` call returns (`:180`). The UI's generic recovery path (`packages/client/domain-ui.js:169`) calls `startRun()` (`:113`), which does not recognize deletion receipts. If an all-data DELETE commits but its response is lost, recovery obtains the original receipt while retaining the user's health draft and journal in browser storage; the deletion receipt is also not presented as the deletion result. A later projection refresh may remove vanished server sources, but it does not clear those local drafts. Apply deletion completion effects centrally for both normal success and original-key recovery, and render the actual deletion receipt. Add a focused lost-DELETE-response regression.

2. **Deleted history selections remain hidden and keep breaking new visit requests.** `packages/client/domain-ui.js:57` loads all `selectedSources` draft IDs but renders controls only for sources still present. `packages/client/domain-ui.js:157` then sends the unchanged full draft array. Neither scope invalidation nor single-source deletion removes deleted IDs (`packages/client/domain-client.js:61`, `:180`). The backend validates every selected source (`services/api/domain-store.mjs:53`). Thus selecting a source for a visit and then deleting it, including from the other client, leaves an invisible selected ID that the user cannot uncheck; generating a card continues to fail. Reconcile selected IDs against the current canonical sources while preserving the concern text and valid selections, and explain removed selections when appropriate. Cover both local deletion and peer deletion followed by refresh.

3. **Historical blocked/interrupted work cannot be found in a fresh session.** `packages/client/domain-ui.js:186`–`:189` discovers runs only from pending changes, finished results, and this session's resolved local operation journal. A blocked/interrupted entry/document run has neither pending change nor result, and a second browser or fresh login lacks that journal. The original source appears, but the user cannot reach the saved run's retry/status controls without manually consulting an export. This misses cross-client recovery of saved work. Integrate the coordinator's authenticated owner-run listing into refresh/discovery and expose appropriate historical run/document status. This is an acknowledged, still-open gap in the reviewed code, not a failure to anticipate the now-planned backend addition.

### Minor (Nice to Have)

- **Terminal-run polling amplifies refresh traffic.** `packages/client/domain-ui.js:188`–`:189` restarts every discoverable run after its previous watch finishes, including terminal runs; the five-second interval repeats discovery (`:197`). Every terminal `pollRun()` performs another full refresh (`packages/client/domain-client.js:193`), and each full refresh currently issues six separately guarded reads (`:118`). This produces repeated full refreshes proportional to historical run count, with overlapping refresh sequences. Cache settled runs and watch only new/active/explicitly refreshed runs; coalesce refresh after a batch of state changes. This becomes more relevant when owner-run discovery is added.
- The implementer's test output reports a visible SQLite ExperimentalWarning. Validation is passing as reported, but output is not pristine; this is a known runtime warning rather than evidence of a client failure.

## Checks and scope

- Read the brief, implementer report, review template, and Task 3 additions/relevant replacement hunks in the supplied diff in chunks. Did not re-read changed source files separately, run git commands, rerun the 19-test/full suite, call a model, or mutate a service/index/HEAD.
- Named cross-task check: to evaluate the hidden-deleted-selection risk, inspected the selected-source validation call in `services/api/domain-store.mjs:53` via one focused text search. No broader backend review was undertaken.
- Ran one focused in-memory `DomainClient` reproduction using a synthetic transport, with no network or service mutation: simulate a committed DELETE whose first response is lost, recover using `retryOperation`, and inspect local state/storage. Exit 0; output was `{"originalKeyReused":true,"healthDraftRetainedAfterRecoveredDelete":true,"persistedDraftRetained":true,"remainingJournalRecords":1}`. This confirms finding 1 without rerunning existing suites. The generic UI recovery path's subsequent `startRun`/refresh has no draft-cleanup behavior.
- The reported 19/19 client/presentation results and fixture screenshots are existing implementer evidence, not a new test/browser run by this reviewer. Cross-task server authorization, runtime provenance truthfulness, late real-runtime effects, and actual export/deletion layer behavior remain subject to the separate backend/runtime reviews and final live acceptance.

## Assessment

**Task quality: Needs fixes.** The domain integration is substantial and has useful focused coverage, but deletion recovery and stale selection handling violate required persistence/recovery behavior. Complete owner-run discovery as already ordered, fix the two client recovery defects, and then conduct the coordinator's genuine live-browser acceptance.
