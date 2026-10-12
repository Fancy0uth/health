# V2 model evaluation: explicit approval blocked

The single V2 real-model launch has **not started**. Automatic approval review rejected the command before process creation. Current state is `blocked-on-explicit-approval`; there are **0 primary attempts, 0 care continuations, 0 actual SDK sessions and 0 model inferences**. All **24 primary cases remain not_run**, with 12 development and 12 heldout cases. These are not failed-model predictions or accuracy results.

The prepared, reviewed evaluation consists of independently authored AI-assisted developer-synthetic literal labels. Labels were not generated from evaluated Agnes outputs or the business validator and were not clinically annotated. No V1 case/gold/result/archive data was used to generate these labels. The dataset remains frozen and unchanged.

## Exact verified launch package

| Item | Value |
| --- | --- |
| Code HEAD | `a7f71c42be60bd3d760133f0a08e6a46d2378ab0` |
| Prelaunch verification UTC | `2026-10-12T07:40:15.091Z` |
| Runner SHA256 | `dd2c2b51d2b632d4423e0e5f294a80e13a9ac905f4fe535b3af9df602777e95e` |
| Dataset freeze commit | `715fa6f` |
| Dataset SHA256 | `7976bcddf9fcd66c1050955d8033da00624a2edad8e68c064dd5c4efa9b2daf1` |
| Manifest SHA256 | `eee02c9724d1667333158d6dfa3b521f36cb4360532730b36251732525535507` |
| Frozen approved generation | `10bed8c45398820ee485` |
| Planned limits | Global concurrency 2; owner concurrency 1; deadline 120 seconds; combined repairs at most 2 |

The exact rejected command was:

```text
node --env-file-if-exists=.env scripts/evaluate-model.mjs --version v2 --dataset tests/fixtures/model-evaluation.v2.json --output .runtime/evidence
```

Automatic approval review stated that this launches a real model evaluation which may use `.env` credentials, external network services and incur costs, and that the human had not explicitly authorized this exact live run or destination. It prohibited bypass or indirect execution. No alternative execution path, credential read/print, limit change, model substitution or case retry was attempted. Current port 4173 service, real-user database, global AGH/account assets and V1 history were not changed.

## Preserved denominators and pending work

The separate [portable V2 record](evaluation-results.v2.json) retains all 24 not-run cases, eight expected W3 continuations, 21 hard raw-time components, nine confirmed hard-schedule components and frozen negation/uncertainty/past-current applicability denominators of 7/8/19. There is no actual raw model archive or per-case SDK evidence because the process never started. Zero success numerators must not be presented as measured model performance.

The scoped evaluator regressions passed 25/25, and syntax/JSON checks passed for 66 modules. Root separately verified 201/201 configured engineering tests and genuine final UI workflows. Engineering and UI acceptance do not replace the pending 24-case independent model evaluation.

The root is requesting explicit human authorization to use the existing Agnes account for this exact 24-primary run and at most eight preselected care continuations under the unchanged normal caps. If authorization arrives, the original command can execute once; every actual failure remains recorded, quota/configuration stops retain the not_run denominator, transport failures cannot be rerun to improve scores, and system interception of unsupported output remains separate from correct model refusal, strict semantics and successful workflow closure. No model accuracy, clinical accuracy, latency/SLA, quota sufficiency or improvement over V1 is claimed.
