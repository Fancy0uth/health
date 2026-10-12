# V2 independent final-version evaluation

Status: preparation and evaluator verification complete; real model execution awaits the root's explicit final-runtime gate. No V2 model inference has occurred. Current port 4173 service, real-user database, account/source configuration and shared AGH installation were not changed.

## Independent annotation and immutable freeze

- Freeze commit: `715fa6f` (only the two owned V2 fixture files).
- Dataset: `tests/fixtures/model-evaluation.v2.json`, SHA256 `7976bcddf9fcd66c1050955d8033da00624a2edad8e68c064dd5c4efa9b2daf1`.
- Manifest: `tests/fixtures/model-evaluation.v2.freeze.json`, SHA256 `eee02c9724d1667333158d6dfa3b521f36cb4360532730b36251732525535507`.
- Approved final asset generation: `10bed8c45398820ee485`.
- Before inference: 24 new inputs, 12 development and 12 heldout, each split containing four entry, four visit and four document cases. There are 26 candidate rows / 130 candidate field components, 16 W2 claims, 21 hard literal-time components and nine independently selected confirmed instructions requiring complete explicit schedules.

Labels are independent AI-assisted developer-synthetic literal annotations. They were not generated using the evaluated Agnes model outputs or the business validator and were not labeled/reviewed by clinical experts. No clinical accuracy claim is made. The frozen manifest's shorter developer-synthetic wording is clarified here without changing its bytes. Requirements were read from the assigned brief, backend specification and target contract. The producer did not read V1 benchmark case/gold/results/archive/review data, and did not derive labels from validator implementation or validator outputs. Evaluator code was read for shape/scoring only. After the root authorized generic PDF helper inspection, new own PDF source formatting was mechanically verified; this did not create semantic labels. Generic Helvetica PDFs cannot preserve CJK/emoji byte strings, so the two newly authored text-layer PDF cases use ASCII English. Emoji cases remain separate entry/visit inputs. All original PDF page/final newlines are retained.

All values and evidence quotes preserve whole original source sentences, source prefixes and terminal punctuation. ASCII PDF sentence evidence includes its original final newline. Unknown/missing clinical fields remain absent rather than negated. Sources cover negation, current/past/uncertain diagnosis, qualifiers, relative offsets, frequency, malformed/non-normalized dates, UTF-16 emoji offsets, PDF page evidence, quoted hostile data, actual current W2 concerns and W3 multiple/partial/no confirmed instructions.

The final_fix/root declared finite temporal policy was supplied before annotation freeze, not inferred from validation output. Strong supported cues require verbatim enclosing raw spans including qualifiers and all cues; frequency/offset time is relative with null endpoints. Malformed or non-normalized dates retain verbatim raw with unknown precision/null endpoints. A lone valid ISO date has two predeclared alternatives: unknown/null endpoints or exact with only the identical literal ISO start and null end. Weak past/current markers permit only the explicitly listed per-case null/unknown/relative alternatives, while assertion/scope/source text remain mandatory. No inferred calendar dates or clinical thresholds are allowed.

## Evaluator changes and verification

Released ownership covered the existing evaluator and its fault tests; runtime, domain, client, schemas and model assets were not edited. V1 offline scoring and summarization functions remain unchanged. V2 has explicit version/dataset/output CLI options and a separate scorer/summary. It differentiates structural first-output failure, literal source support, assertion/scope, strict case coverage, hard raw-time completeness, confirmed-instruction/task coverage and hard schedule completeness. Missing or truncated schedules fail even when full task text survives. Original Core-rejected SDK args cannot be replaced by repaired/admitted args for raw metrics. Missing acceptance/primary evidence still stays in the 24-case denominator. Unknown-only observed guarded refusal is separate from successful workflow closure.

At launch the evaluator records its exact SHA, code HEAD, dataset/manifest SHA and freeze commit, schema/Skill/plugin/adapter SHA, provider/model metadata and before-call timestamps. Each case retains frozen gold, immutable source hash/input, actual SDK first-stage/repaired/error events, admitted stage records, closure metadata and actual user-confirmed instruction records. W3 confirmations follow the fixed independently selected quote list; continuations are counted separately. No inference limit, fallback provider, prompt/asset tuning or heldout gold adjustment was introduced.

Verification evidence:

- Fresh prefreeze independent checks: 24 distinct IDs; 12/12 splits; 4/4/4 workflows per split; source SHA, exact UTF-16 quotes, PDF text/page round-trip, null endpoints, literal qualifiers and task-confirmation membership all verified.
- Five new V2 evaluator tests observed RED for missing functions/versioned CLI, then GREEN. The actual public SDK observation regression also observed RED before V2-only stage-result retention, then GREEN; it now preserves the real Core error object alongside first arguments.
- `node --test tests/faults/evaluation.test.mjs`: final 19 passed, zero failures. The final CLI routing regression first failed because explicit V1 output was written to an argv flag instead of the requested path, then passed; legacy and explicit-V1 summary JSON are byte-value equivalent.
- Complete `npm test` under socket-authorized execution before the final CLI-routing-only fix: 175 total, 174 passed, zero failures, one existing skipped test (`the bundled public AGH SDK loads with its real CommonJS dependencies`). Initial sandbox-only full-suite execution failed at loopback `listen EPERM`; the authorized rerun completed successfully.
- `npm run check`: syntax and JSON checks passed for 66 JavaScript modules.
- The skipped dependency check was then run with configured environment (`node --env-file-if-exists=.env --test tests/sdk-build.test.mjs`): one passed, zero skipped. This loads the public SDK/CommonJS dependencies and does not perform inference.

## Pending execution

The root must clear the scoped final-fix review gate before the once-only live run. Planned command uses the V2 dataset and a new isolated evidence directory. Normal limits remain global concurrency 2, owner concurrency 1, deadline 120 seconds and maximum two combined repairs. Any quota/configuration stop must record remaining cases as not_run; no silent retry or substitute model. V2 results and validation report will be separate new artifacts. V1 assets/metrics are historical and will not be relabeled or used to claim model improvement under new label rules.

## Scoped independent-review fixes (four Important findings)

All four named reproductions were added before fixes and observed RED; each was then run individually and observed GREEN. Frozen dataset/manifest, production/runtime/assets and V1 historical behavior remain unchanged. No model inference occurred.

1. **Unreadable first SDK detail:** V2 records every SDK call identity/result sequence/detail status/error, including calls whose details cannot be read. An unresolved earlier call conservatively makes first-stage evidence `unobserved_incomplete_first_stage`; later repaired details and admitted fallback cannot be promoted to raw. If no genuine SDK stage is observed, V2 does not invent a fallback raw stage. Original identity/error and all readable later stage arguments/results are retained. The exact seq1/2 unavailable, seq3/4 readable regression passes. An actual public scripted SDK session also proves that its real Core-rejected first stage remains unobserved after genuine repair when the first readToolDetail is deliberately unavailable.
2. **Rejected care continuation:** The same Core-prevalidation rule now applies to primary and care continuation runs. Actual rejected args/results remain intact, while structural/raw-semantic success, matched components and hard schedule/time credit are denied. The reproduction uses the frozen two-instruction case with exact confirmed refs and complete task text, but Core-rejected null operation_key; raw structural/semantic pass is false and schedule credit is zero.
3. **Frozen preservation denominator:** Negation/uncertainty/past-current applicability now comes from each frozen dataset split, including absent, failed and not-run cases. Captured rows only contribute preserved counts. An entirely not-run V2 evaluation retains all 24 cases and applicability denominators 7/8/19 under the unchanged label-category definition, with zero preserved. Missing primary capture likewise leaves the denominator unchanged.
4. **Positive guarded-refusal evidence:** Empty candidates alone cannot establish correct refusal. Classification now requires the intended actual guard error, a correlated SDK stage/result and AGH/session ledger, matching failed business admission, immutable source preservation and explicit zero fact/change/result/task persistence counts. The live collector records these counts from the isolated synthetic store. MODEL_TRANSPORT_ABORTED, absent AGH/session/result/admission evidence, missing state proof or persisted candidates cannot count as correct guarded refusal. They remain distinct execution failures. The positive and all named negative reproductions pass.

Fresh scoped-fix verification:

- `node --test tests/faults/evaluation.test.mjs`: 24 passed, zero failed/skipped. This includes the four exact review regressions and actual scripted SDK observation boundary, plus existing V1/default/offline compatibility tests.
- Configured fixture-only complete suite (`node --env-file-if-exists=.env scripts/test.mjs`, authorized loopback socket execution): 200 passed, zero failed/skipped.
- `npm run check`: syntax/JSON passed for 66 modules.
- Source/gold manifest SHA will be checked again immediately before the owned-only commit. The runner is frozen after this scoped change until independent re-review/root UI gate permits the once-only real V2 run.
