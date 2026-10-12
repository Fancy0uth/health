# Task 5 frequency delimiter fix

Scope: only the supported-frequency punctuation regression in `task-5-residual-rereview.md`. The earlier malformed-token and action-schedule findings were already addressed and remain covered. No new time vocabulary, semantic interpretation, model inference, service/database operation, assets, frozen data, evaluator or result changes.

The validator now separates numeric-offset alternatives from word-based relative/frequency alternatives. Numeric offsets retain their complete-token separator guard, including `1,5天后` and decimal/identifier protection. Existing word cues use ASCII word boundaries, so comma, period, colon, semicolon, slash, plus/minus, parentheses and common Chinese punctuation no longer suppress an otherwise supported frequency word. Date handling and the no-action-time/legacy-confirmed continuation guards are unchanged.

## Evidence

- Exact RED: all **4 new tests failed** while the existing **30 integration tests passed**. Reproductions: `Record symptoms,daily.`, `Record symptoms,weekly.`, and `记录症状,每日一次。`; the fourth test covers 13 punctuation delimiters × 8 existing frequency forms on both sides, plus ASCII-identifier and numeric-separator controls.
- GREEN: **34/34 integration tests passed**. Each exact comma case rejects missing raw time, accepts correct literal raw, confirms normally and produces a care schedule containing that same literal. Prior malformed date, decimal, spaced qualifier, weak marker, no-action-time and immutable legacy-data tests remain green.
- Final full suite: **195/195 passed**, zero failures/skips/cancellations, using `AGH_ROOT=<pinned local upstream> npm test`.
- `npm run check`: **66 JavaScript modules/JSON passed**. `git diff --check`: clean.
- Full suite includes pinned public SDK build and genuine scripted-provider SDK fixtures; no product-model calls. Expected SQLite ExperimentalWarning remains.

Logs: `/tmp/task5-delimiter-red.log`, `/tmp/task5-delimiter-green.log`, `/tmp/task5-delimiter-full.log`, `/tmp/task5-delimiter-check.log`.

Only `services/api/source-validation.mjs`, `tests/domain/final-integration.test.mjs` and this report belong to the commit. Trusted Skill generation remains unchanged; no claim of genuine UI or V2 inference completion is made here.
