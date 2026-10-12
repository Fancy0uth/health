# Task 5 residual I1 fix

Scope: only the two remaining Important I1 defects from `task-5-rereview.md`. I2–I6 and M1–M4 remain closed; their production behavior was not redesigned. Changes are limited to the source validator, one care-continuation guard, regression tests and policy documentation. No model calls, service/demo DB changes, subagents, frozen V1/V2 data, evaluator/results, Skill assets or approved hashes were changed.

## Complete literal tokens

The recognizer now captures whole numeric/date-like tokens before validating precision. Invalid year/day widths (`12026-03-04`, `2026-03-041`), decimal date components and qualified dates (`约 2026-03-04`, including tab-separated qualifier) remain verbatim raw/unknown/null endpoints. Only an entire valid unqualified ISO date can be exact. Decimal/separator offsets (`1.5天后`, `约 1.5天后`, `1,5天后`, `after approximately 1.5 days`) remain complete literal relative text with null endpoints; no numeric/locale conversion occurs. ASCII identifier/numeric boundaries prevent extracting valid-looking prefixes or suffixes. Commas separating two complete dates do not merge into a numeric component or hide the second date.

## No action text as time or schedule

`validateSourceTime` is shared by candidate validation (therefore current confirmation) and care continuation. With no recognized strong cue, only null/unknown or supported exact weak past/current markers/adjacent marker groups are permitted. `Record` is neither a relative nor unknown time expression. Existing manual construction continues using the same source classifier and emits null/unknown for ordinary action sentences.

**Deliberate legacy policy:** each confirmed instruction used by a care continuation must pass current source-time validation before schedule equality is considered. A historical immutable confirmed instruction carrying raw `Record`/relative rejects both `schedule:'Record'` and `schedule:null`, with `INVALID_AGENT_OUTPUT`; no result/task is persisted, and the historical fact/source remains unchanged. The system does not silently rewrite the old fact, substitute new model metadata, normalize a date, or create a regeneration API. A legitimate `Record symptoms.` instruction with null/unknown time still stages, confirms and produces a null-schedule care task. Supported English qualifiers remain complete through normal confirmed care.

## Verification

- Initial residual RED: **12 new tests failed**, while 15 prior integration tests passed. Failures reproduced all four reviewer examples plus qualifier/date/decimal/manual/legacy-continuation boundaries. Each now passes.
- Additional RED→GREEN checks cover decimal comma suffix truncation and comma-separated complete dates. Final focused integration: **30/30 passed**.
- Combined domain/source-binding focused run: **58/58 passed** before the final additional comma-date case.
- Full suite before the last comma-date case: **190/190 passed**, zero skips/failures, including genuine SDK scripted-provider fixtures and the public SDK bundle check with explicit pinned AGH_ROOT.
- Final complete suite: **191/191 passed**, zero failures/skips/cancellations, with `AGH_ROOT=<pinned local upstream> npm test`; full log `/tmp/task5-residual-final-suite.log`.
- `npm run check`: 66 JavaScript modules/JSON passed. `git diff --check`: clean.
- `verifyApprovedAssets()` confirms generation **10bed8c45398820ee485** unchanged. No new installation generation is needed; tools, Skills, repair budget and authentication/scope/queue/lifecycle boundaries are unchanged.

Local engineering logs: `/tmp/task5-residual-red.log`, `/tmp/task5-residual-target.log`, `/tmp/task5-residual-final-green.log`, `/tmp/task5-residual-final-suite.log`, `/tmp/task5-residual-check-final.log`. SQLite ExperimentalWarning is expected. This evidence contains no new real-model quality claim. Root owns scoped final source review, genuine UI acceptance and the once-only independent frozen V2 evaluation.
