# Spec Compliance

- ❌ Issues found: V2 can substitute a repaired SDK stage for an unreadable first stage; Core-rejected continuation output can pass raw metrics; preservation denominators omit not-run cases; unrelated failures can count as correct guarded refusals. References and focused reproductions follow.
- ⚠️ Live execution remains unverified and gated: actual SDK/session correlation, runtime limits, before-call timestamps and portable retained evidence must be checked against the once-only run after these findings and the separate source-boundary gate are cleared. No V2 inference was performed during this review.
- ⚠️ Annotation independence and prefreeze blindness are producer attestations, not facts a code diff can prove. The frozen annotations and report identify developer-synthetic labels without clinical expert review; this review makes no clinical-correctness claim.

# Strengths

- `scripts/evaluate-model.mjs:57`, `:76`: separate V2 scoring requires literal source references, declared time alternatives, qualifier-preserving raw time and complete confirmed-instruction schedules. A missing schedule does not pass merely because full task text is present.
- `scripts/evaluate-model.mjs:101`, `:103`, `:104`: primary strict-case, candidate-component, hard-time and hard-schedule denominators are calculated from the frozen dataset, keeping missing primary captures in the 24-case total.
- `scripts/evaluate-model.mjs:40`, `:122`, `:132`: V2 retains actual SDK stage result objects and lightweight events; launcher metadata records evaluator/code/dataset/manifest/assets before runtime creation; the raw archive remains separate from the summary.
- `scripts/evaluate-model.mjs:142`, `:166`, `:182`: V1 scorer/summary logic and historical schema remain separate; explicit V1 output routing is covered by the final regression in `tests/faults/evaluation.test.mjs:101`.

# Issues

## Critical

- None found in this task scope.

## Important

1. **An unreadable first SDK stage is replaced by a later repaired stage.** `scripts/evaluate-model.mjs:35`, `:40`, `:129`, `:131`: `collect()` omits a call whose `readToolDetail()` throws, while `selectFirstStage()` sorts only successfully read stage records. `capture()` therefore selects the second stage despite an earlier detail error, labeling it observed raw output. Focused pure synthetic reproduction: tool/call+result at seq 1/2 has unavailable detail; repaired stage at seq 3/4 returns valid detail. The retained ledger contains `detail_errors:[{call_seq:1,code:'SDK_DETAIL_UNAVAILABLE'}]`, yet selected raw `call_seq` is 3. Keep the earliest stage identity and mark first-stage evidence unobserved/incomplete when it cannot be recovered; never promote a later stage. Add a regression for this observation failure, including the admitted fallback path.

2. **Core-rejected W3 continuation first output can pass structural/raw scoring.** `scripts/evaluate-model.mjs:94`, `:95`, `:96`: the scorer visits both primary and continuation, but the Core-prevalidation failure override applies only to `c.primary`. Focused reproduction using frozen `v2-dev-document-01`: supply exact confirmed facts and a complete two-task payload as continuation raw args, with `is_error:true`, `operation_key:null`, and `admitted_stage_calls:[]`. Its raw metrics are `structural_pass:true`, `semantics_pass:true`, `schedule_preserved:2`. This incorrectly credits an output rejected before business admission. Apply the same first-stage structural-failure determination to every run, retaining the actual rejected args/results, and cover care continuations explicitly.

3. **Negation/uncertainty/tense preservation loses the frozen denominator when evidence is missing.** `scripts/evaluate-model.mjs:104`: `applicable_cases` is computed from captured cases (`cs`), whereas applicability is a property of frozen labels. Focused reproduction: `summarizeEvidenceV2({cases:[]}, frozenDataset)` reports `cases:24`, `not_run:24`, but raw negation `{preserved:0,applicable_cases:0}` even though the frozen candidate labels alone contain two negation-applicable cases. Thus configuration failures or not-run cases disappear from these quality rates. Calculate category applicability from the frozen split and count absent/failed captures as not preserved; retain any observation-only statistic under a separate explicit name.

4. **An unrelated failed turn can count as a correct guarded refusal.** `scripts/evaluate-model.mjs:98`, `:99`: `correct_refusal` only checks empty unknown-only raw candidates, absent final candidates and a limited exclusion regex. It does not require an observed guard rejection, actual SDK result/session evidence, source preservation, or absence of persistence. Focused reproduction using frozen `v2-dev-entry-04`: raw `args.candidates:[]`, `error:'MODEL_TRANSPORT_ABORTED'`, no `agh`, no guard evidence and `final_candidates:null` produces `correct_refusal:true`. Require positive evidence of the intended guarded refusal and its safe persisted state; leave an unclassified execution failure distinct from a correct refusal and successful workflow closure.

## Minor

- None reported.

# Checks

- Reviewed only package `review-715fa6f..bcd6ceb.diff`, BASE `715fa6f`, HEAD `bcd6ceb`. The first tool output truncated the evaluator's middle hunk; only that truncated range was subsequently read with context. No changed source file was read separately, and no git command was run.
- Named outside-diff check: frozen label/manifest shape and denominators were inspected only to determine applicable labels for the missing-evidence and continuation reproductions; no gold was generated or modified.
- Ran one focused, pure in-memory Node check for the four named scoring/observation risks above. It imported evaluator exports and read frozen V2 fixtures; it made no model call, opened no listener, and touched no database. All four unexpected outputs reproduced.
- Did not rerun the evaluator suite or full test suite. The implementer's report records 19 evaluator tests passing and separately qualifies that the complete suite preceded the final CLI-only routing fix.

# Assessment

**Task quality: Needs fixes.** The separate scorer and evidence archive are useful, but the four reproducible paths can credit repaired/rejected/failed output or shrink frozen quality denominators. Keep the real-evaluation gate closed until the fixes and a scoped follow-up review clear these findings.
