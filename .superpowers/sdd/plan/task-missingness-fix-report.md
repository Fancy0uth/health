# Finite information-missingness fix

## Root cause and scope

The shared surface classifier marked `药物过敏情况不知道。` as affirmed because 不知道 was absent from its finite unsupported list. `药名没有记录。` hit the ordinary 没有 negation marker and became negated. Both could therefore stage under the existing extractive quote checks, even though the source described absent information. This is a domain-validation/spec defect, not a model/prompt tuning exercise.

The source validator is the only changed production file; existing store staging/confirmation/manual paths already call it. New `tests/domain/missingness.test.mjs` exercises actual in-memory DomainStore transactions. The specification records the precise conservative behavior. No runtime Skill/manifest/schema, tool registry, provider, limits, model, evaluator or frozen data/result file changed. No model calls, extra evaluation, demo DB/service operations, subagents, push, merge or deploy occurred.

## Finite policy

Recognize existing 未提及/未询问/不详/not mentioned/not assessed plus explicit information-missingness forms 不知道/不清楚/未知, 未/没[有]/无 + 记录/记载/提供, and English unknown, not known/recorded/documented/provided, do/does not know, don't/doesn't know, no information/record(s). These surface markers take precedence over ordinary negation in the shared classifier, emit `uncertain` and remain unsupported for **all new/correction candidates**, including `reported_text`. Changing the proposed assertion to uncertain does not make an unknown clinical value a fact. Source acceptance still preserves the full original, and explicit reanalysis can produce a source-only empty candidate checkpoint.

Explicit denials (`无头痛`, `没有发热`, `No headache`, `No known allergies`) and existing consideration/rule-out uncertainty remain supported. This finite list is not general semantic NLP; ambiguous and unsupported complete sentences still reject rather than dropping clauses or inferring a medical meaning.

### Manual operations

Manual correction uses the same classifier. An unknown correction is rejected transactionally: no new source/proposal/fact/receipt commits, the existing source/fact stays unchanged, and the client retains its unsent correction text through its existing draft flow. Already-accepted input sources are never deleted by candidate rejection.

An **explicit user `reported_text` retraction** may retain missing information as an `uncertain` withdrawal reason. Confirmation only appends a `review_status: retracted` history revision and removes the prior fact from the active profile. It does not create an affirmative/negative clinical assertion. Clinical-field retraction proposals do not get this exception. Source/quote, scope, ownership, consent, CAS, audit/receipt and confirmation checks remain in force; models can only stage `new` proposals and cannot invoke user retraction.

## RED → GREEN evidence

Initial exact RED run: 5 new defect tests failed, 1 explicit-denial/uncertainty control passed. The two exact reproductions independently accepted their previously invalid proposals. Additional failures covered finite synonyms, old stored checkpoint confirmation and manual correction/retraction. After the finite classifier/guard change:

- 7/7 focused missingness tests passed, including all three proposed assertion labels for 16 source forms.
- Existing + new domain/integration run: 65/65 passed (before the final additional retraction/field-boundary test).
- Both old bad checkpoints reject confirmation atomically: profile revision, immutable fact revisions, source records, changes, audits, operations and idempotency receipts are identical before/after failure. The same saved source is explicitly reanalysed, with a new legal empty candidate checkpoint and no new source or formal fact; old checkpoint expires.
- Unknown manual corrections reject; uncertain user withdrawal reasons commit only retracted history. Existing confirmed fact/source history remains unchanged. A clinical-field variant is rejected.
- Full engineering suite: **208/208 passed**, zero failures/skips/cancellations, using explicit pinned AGH_ROOT. Final focused 7/7 also passed after strengthening the rollback snapshot to include original sources. No model inference was performed.
- Syntax/JSON check: 67 JavaScript modules passed. `git diff --check` clean. Expected SQLite ExperimentalWarning remains.
- `verifyApprovedAssets()` returns unchanged generation **10bed8c45398820ee485**; no asset reinstall or new generation is claimed necessary.

Logs: `/tmp/task-missingness-red.log`, `/tmp/task-missingness-target.log`, `/tmp/task-missingness-focused-final.log`, `/tmp/task-missingness-full.log`, `/tmp/task-missingness-check.log`.

## Evaluation boundary

The once-only frozen V2 archive remains the historical **pre-fix CF632 execution with 6/24 strict final cases**, as reported by root. This fix does not alter its dataset, raw events, scoring, results or measured version, and does not rerun inference. The current source-validation code differs from that measured execution even though trusted Skill asset generation is unchanged. Engineering tests demonstrate the finite guards and transaction behavior only; no current-version model-quality score is claimed. Root owns independent narrow review and any separately authorized future model validation.
