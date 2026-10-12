# V2 independent final-version evaluation

Status: preparation and evaluator verification complete; real model execution awaits the root's explicit final-runtime gate. No V2 model inference has occurred. Current port 4173 service, real-user database, account/source configuration and shared AGH installation were not changed.

## Independent annotation and immutable freeze

- Freeze commit: `715fa6f` (only the two owned V2 fixture files).
- Dataset: `tests/fixtures/model-evaluation.v2.json`, SHA256 `7976bcddf9fcd66c1050955d8033da00624a2edad8e68c064dd5c4efa9b2daf1`.
- Manifest: `tests/fixtures/model-evaluation.v2.freeze.json`, SHA256 `eee02c9724d1667333158d6dfa3b521f36cb4360532730b36251732525535507`.
- Approved final asset generation: `10bed8c45398820ee485`.
- Before inference: 24 new inputs, 12 development and 12 heldout, each split containing four entry, four visit and four document cases. There are 26 candidate rows / 130 candidate field components, 16 W2 claims, 21 hard literal-time components and nine independently selected confirmed instructions requiring complete explicit schedules.

Labels are developer-synthetic literal annotations, with no clinical expert review or clinical accuracy claim. Requirements were read from the assigned brief, backend specification and target contract. The producer did not read V1 benchmark case/gold/results/archive/review data, and did not derive labels from validator implementation or validator outputs. Evaluator code was read for shape/scoring only. After the root authorized generic PDF helper inspection, new own PDF source formatting was mechanically verified; this did not create semantic labels. Generic Helvetica PDFs cannot preserve CJK/emoji byte strings, so the two newly authored text-layer PDF cases use ASCII English. Emoji cases remain separate entry/visit inputs. All original PDF page/final newlines are retained.

All values and evidence quotes preserve whole original source sentences, source prefixes and terminal punctuation. ASCII PDF sentence evidence includes its original final newline. Unknown/missing clinical fields remain absent rather than negated. Sources cover negation, current/past/uncertain diagnosis, qualifiers, relative offsets, frequency, malformed/non-normalized dates, UTF-16 emoji offsets, PDF page evidence, quoted hostile data, actual current W2 concerns and W3 multiple/partial/no confirmed instructions.

The final_fix/root declared finite temporal policy was supplied before annotation freeze, not inferred from validation output. Strong supported cues require verbatim enclosing raw spans including qualifiers and all cues; frequency/offset time is relative with null endpoints. Malformed or non-normalized dates retain verbatim raw with unknown precision/null endpoints. A lone valid ISO date has two predeclared alternatives: unknown/null endpoints or exact with only the identical literal ISO start and null end. Weak past/current markers permit only the explicitly listed per-case null/unknown/relative alternatives, while assertion/scope/source text remain mandatory. No inferred calendar dates or clinical thresholds are allowed.

## Evaluator changes and verification

Released ownership covered the existing evaluator and its fault tests; runtime, domain, client, schemas and model assets were not edited. V1 offline scoring and summarization functions remain unchanged. V2 has explicit version/dataset/output CLI options and a separate scorer/summary. It differentiates structural first-output failure, literal source support, assertion/scope, strict case coverage, hard raw-time completeness, confirmed-instruction/task coverage and hard schedule completeness. Missing or truncated schedules fail even when full task text survives. Original Core-rejected SDK args cannot be replaced by repaired/admitted args for raw metrics. Missing acceptance/primary evidence still stays in the 24-case denominator. Unknown-only observed guarded refusal is separate from successful workflow closure.

At launch the evaluator records its exact SHA, code HEAD, dataset/manifest SHA and freeze commit, schema/Skill/plugin/adapter SHA, provider/model metadata and before-call timestamps. Each case retains frozen gold, immutable source hash/input, actual SDK first-stage/repaired/error events, admitted stage records, closure metadata and actual user-confirmed instruction records. W3 confirmations follow the fixed independently selected quote list; continuations are counted separately. No inference limit, fallback provider, prompt/asset tuning or heldout gold adjustment was introduced.

Verification evidence:

- Fresh prefreeze independent checks: 24 distinct IDs; 12/12 splits; 4/4/4 workflows per split; source SHA, exact UTF-16 quotes, PDF text/page round-trip, null endpoints, literal qualifiers and task-confirmation membership all verified.
- Five new V2 evaluator tests observed RED for missing functions/versioned CLI, then GREEN.
- `node --test tests/faults/evaluation.test.mjs`: 18 passed, zero failures.
- Complete `npm test` under socket-authorized execution: 175 total, 174 passed, zero failures, one existing skipped test (`the bundled public AGH SDK loads with its real CommonJS dependencies`). Initial sandbox-only full-suite execution failed at loopback `listen EPERM`; the authorized rerun completed successfully.
- `npm run check`: syntax and JSON checks passed for 66 JavaScript modules.

## Pending execution

The root must clear the scoped final-fix review gate before the once-only live run. Planned command uses the V2 dataset and a new isolated evidence directory. Normal limits remain global concurrency 2, owner concurrency 1, deadline 120 seconds and maximum two combined repairs. Any quota/configuration stop must record remaining cases as not_run; no silent retry or substitute model. V2 results and validation report will be separate new artifacts. V1 assets/metrics are historical and will not be relabeled or used to claim model improvement under new label rules.
