# Finding Verdicts

- **Unreadable first SDK stage promoted to repaired raw** — ADDRESSED. `scripts/evaluate-model.mjs:40`, `:46`, `:147`, `:148` preserve unresolved call identity/error, conservatively return null raw, retain later readable details, and use the V2 selector without admitted fallback. The fix adds both the exact in-memory seq1/seq3 regression and an actual scripted public-SDK repair regression in `tests/faults/evaluation.test.mjs:109`, `:130`.
- **Core-rejected W3 continuation credited as raw success** — ADDRESSED. `scripts/evaluate-model.mjs:112` applies the prevalidation rule to primary and continuation, clears structural/semantic and matched/time/schedule credit, and preserves actual first args/results. The complete two-instruction rejected-continuation regression is at `tests/faults/evaluation.test.mjs:116`.
- **Preservation denominator omits not-run cases** — ADDRESSED. `scripts/evaluate-model.mjs:120` derives applicability from the frozen expected split; captured rows contribute only the preserved numerator. The all-not-run/missing-capture regression checks frozen applicability 7/8/19 in `tests/faults/evaluation.test.mjs:120`.
- **Unrelated failure counted as correct guarded refusal** — NOT ADDRESSED completely. `scripts/evaluate-model.mjs:99`, `:100`, `:101`, `:103` eliminate the demonstrated false positive and add positive SDK/admission/state checks, but require a failed run to possess successful `agh` and `sdk_evidence` metadata. The actual collector cannot produce that positive state; see the Important issue below. The positive test at `tests/faults/evaluation.test.mjs:124` constructs that impossible combination instead of checking a real failed-run capture.

# New Breakage in the Fix Diff

- **Important — positive refusal condition cannot be satisfied by a genuinely failed live run.** `scripts/evaluate-model.mjs:99`, `:100` require `status==='failed'` and both `run.agh.session_id` and matching `run.sdk_evidence.session_id`. Focused interface inspection shows `services/api/agnes-agent.mjs:62` records runtime evidence and `:63` returns `agh` only after successful receipt correlation; the failure path at `:64` records diagnostic/session evidence and throws. `services/api/domain-jobs.mjs:58`, `:59`, `:66`, `:67`, `:69` set runtime metadata only for the successful needs-review/completed path and only call `failRun` for failed execution. `services/api/domain-store.mjs:1354`, `:1369` likewise do not attach success metadata to failed runs. Consequently, the live collector's failed run has no successful AGH closure metadata, and the new condition classifies every genuinely failed guarded refusal as false. Use the actual bound failed SDK session, retained call/result and diagnostic correlation for refusal proof; preserve successful closure as a separate metric. Replace or supplement the impossible positive fixture with a captured failure-shaped regression, without fabricating success metadata.

# Out-of-Scope Observations

- None.

# Checks

- Read only fix package `review-8ba8460..b87adb8.diff`, BASE `8ba8460`, HEAD `b87adb8`, and the appended fix report. The initial tool output truncated the middle hunk; only the missing range was read subsequently.
- Named outside-diff interface risk: whether a failed live run can carry the positive classifier's required AGH/evidence metadata. Inspected only the adapter return/error path, dispatch success/failure metadata path, failRun/setRuntime methods, and relevant stage/schema interface. No broad source review was performed.
- The fix report names the covering regressions and reports 24 evaluator tests passing, 200 configured full-suite tests passing, zero failures/skips, and syntax/JSON checks passing. The diff contains covering tests for all four original reproductions and an additional actual scripted-SDK first-detail test. No suite was rerun.
- No model call, listener, database mutation, git command, source edit, fixture edit, or subagent dispatch occurred in this re-review.

# Verdict

**Fix round: Findings remain open — finding 4, positive guarded-refusal classification.** Findings 1–3 are addressed; evaluator gate remains closed pending the small failure-session correlation correction and scoped verification.
