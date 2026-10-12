- **Reload after a lost all-delete response erases its opaque recovery handle** — ADDRESSED. `packages/client/domain-client.js:147` establishes authoritative owner/CSRF/session identity, restores opaque DELETE handles, observes the server watermark, and only then restores drafts/body journals. The login path uses the same order at `:155`. `restoreDeletionHandles` (`:53–56`) reads only the actual owner/session recovery key, filters matching owner/session fields, and uses the existing projection (`:50–51`) to retain the original operation ID/key/target/scope epoch with an empty body. On the newer all-clear observation, existing cleanup (`:80–85`, `:99`) preserves those loaded handles while removing owner health drafts/body journals before full restore. The specific fresh-instance ordering defect no longer exists.

### New Breakage in the Fix Diff

- None identified in the two-file fix. The scope watermark remains monotonic (`packages/client/domain-client.js:94–95`); this change neither substitutes a newer operation scope epoch nor upgrades an old unknown health-body payload. Original-key recovery still sends `op.scopeEpoch` (`:230`), and owner/session checks remain in `:257–260`.

### Checks

- Read the Task 3 brief, previous rereview's new Important finding, appended fix round 2 report, scoped re-review template, and supplied `review-621be3f..03af5b2.diff` once. The review package contains only `packages/client/domain-client.js` and `tests/client/domain-client.test.mjs`. Previous review head `12f5829` and intermediate frozen model-dataset commit `621be3f` were acknowledged; unrelated dataset work is outside this package and was not reviewed.
- Inspected the helper's immediate restore/cleanup/identity/recovery context and the new regression at `tests/client/domain-client.test.mjs:164–168`. Its setup uses an actual loopback HTTP server, session-cookie transport and authenticated clients (`:24–39`), with explicitly synthetic model outputs. The test commits DELETE and loses its response, disposes the first client, and initializes a new client sharing storage/session. It asserts no draft leaks during bootstrap, removal of the other-session health journal, survival of the original key and original lower scope epoch in an empty-body handle, recovery of the exact committed receipt using the original epoch header, an all-clear counter of one, and removal of the resolved handle. This covers the reopened defect, including the reload step absent from the earlier same-instance test.
- The appended report names the covering command `node --test tests/client/domain-client.test.mjs tests/client/presentation.test.mjs` and records exit 0, **31/31 passed**, no skips, duration 2380.527833 ms; it also records both modified-file syntax checks and diff whitespace validation. These remain implementer-reported results, checked against the added regression and change scope, not a reviewer rerun. No specific unresolved code doubt required an additional test.
- No source/index/HEAD changes, git commands, subagents, full-suite rerun, model calls, UI rerun or browser acceptance. Only this rereview report was written. The original three closed Important findings and polling minor were not reopened; SQLite ExperimentalWarning remains disclosed and non-blocking.

### Out-of-Scope Observations

- None. Genuine browser acceptance remains coordinator work after this gate. Task 4's active faults/evaluation/docs/contracts work was not reviewed.

### Verdict

**Fix round: All findings addressed, no new Critical/Important breakage** — the single reopened Important reload-recovery finding is closed. This scoped gate permits coordinator browser acceptance; it does not claim that acceptance has occurred.
