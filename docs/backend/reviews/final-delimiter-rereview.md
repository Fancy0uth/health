- **Supported-frequency punctuation regression — ADDRESSED.** `services/api/source-validation.mjs:252` separates numeric-offset forms from existing word-based relative/frequency forms. `:259` retains the numeric separator/identifier guard, while `:261` uses ASCII word boundaries for word cues, allowing ordinary punctuation before and after `daily`, `weekly`, `每日` and the other already-supported forms. This fixes all three reported comma examples without weakening numeric-token or date handling. The enclosing raw span and precision policy remain unchanged.
- **End-to-end regression evidence — COVERED.** `tests/domain/final-integration.test.mjs:523` verifies each original comma case now rejects omitted raw time, accepts its exact literal, confirms normally and produces the same literal care schedule. `:545` covers 13 punctuation delimiters × 8 existing frequency forms, plus rejected embedded identifiers and intact `1,5天后` numeric text. The assertions exercise the reported failure and the boundary distinction introduced by this fix.

## New Breakage in the Fix Diff

- None found. The production change is limited to splitting regex alternatives and applying the appropriate boundary to each. It adds no vocabulary, date normalization, source rewriting, mutation path or permission change. The previously reviewed action-time and legacy-continuation guards are untouched.

## Out-of-Scope Observations

- None. Previously closed findings and undeclared temporal interpretation were not reopened.

## Checks

- Read the supplied `b34ea25..8ba8460` three-file diff package once and inspected its production/test lines and fix report.
- Inspected `/tmp/task5-delimiter-green.log`: **34/34 passed**, zero failures/skips/cancellations, explicitly including the three comma workflows and punctuation matrix.
- Inspected `/tmp/task5-delimiter-full.log`: **195/195 passed**, zero failures/skips/cancellations. Inspected `/tmp/task5-delimiter-check.log`: **66 JavaScript modules and JSON checks passed**. These are the implementer's recorded executions; no suite or focused test rerun was necessary because the supplied assertions and output answer this finding.
- No model, browser, service, database, provider, git/index/HEAD, asset or dataset operation was performed. No subagent was dispatched. This report is the only file written. No genuine UI or V2 inference success is claimed.

## Verdict

- **Fix round: All findings addressed, no new Critical/Important breakage. CLEAR source review gate.** The sole remaining delimiter finding is closed; root can proceed with the separately required genuine UI acceptance and independent frozen V2 evaluation.
