# 健康画像与诊后接续 Implementation Plan

> For agentic workers: Use superpowers:subagent-driven-development. User explicitly authorized complete implementation and real model/browser verification; continue within scope without another approval gate.

Goal: deliver structured health profile, old/new medical reconciliation, grounded care explanations, and feedback-to-dialogue on desktop/mobile.
Architecture: extend existing versioned facts/review workflow, shared DomainClient/NativeBridge and native apps. Keep raw evidence unchanged. Add focused backend module(s), versioned optional schema extensions compatible with old data. No deployment/push/packaging.
Tech Stack: existing Node/SQLite, vanilla web/mobile, pinned Agnes SDK/Host.

## Contract to implement
- A candidate (manual legacy or natural indexed selection) may carry `health_observations`: array of {dimension, value, unit?, observed_at?}. dimension is body_site|symptom|onset|course|self_rating|impact|context|associated|measurement|background. value nonempty string; unit/observed_at nullable strings. Values must be supported by referenced patient sentence; preserve exact snippets wherever practical. Never inferred scores/units/dates. Validation errors must be field-specific; old candidates without metadata continue to work.
- Store validated observations on pending proposals and confirmed fact versions. GET /api/profile retains facts/pending_changes and adds `health_profile` with observations (each with fact_id/revision/review_status/source refs), current_problems, events, background, unknowns/conflicts. UI shows all four views, dimension labels, source/review state and unknowns. Confirmed rows can be corrected using existing fact change flow; event status separate mutable object, PATCH /api/episodes/:id with status active|improved|resolved and expected_version, preserving immutable historical episode.
- Stage candidates optional `comparisons`: array {candidate_index, fact_id, revision, relation:conflict|update|duplicate|related, reason}. Only readable confirmed same-owner current fact refs. Server attaches comparison old/new snapshots; do not silently replace. Server should surface conservative possible conflicts for supported same dimensions even if model omitted, and existing same-category facts available for user comparison.
- Confirm request optional `resolutions`: [{candidate_id, fact_id, revision, action:replace|keep_both|keep_existing|defer}]. Conflicts selected without resolution blocked. Unselected conflicting candidates remain pending or explicitly deferred, never accidentally confirmed. Replace versions only selected fact with CAS + history and stale propagation; keep_both distinct dated records; keep_existing doesn't write new fact; defer retains reviewable uncertainty. Must handle partial confirmation deliberately.
- Care payload tasks keep exact text/instruction_refs/schedule, optional explanation and questions. Explanation is clearly model paraphrase; never grants medication changes; retain original dose/frequency and ambiguity. Server strips no clinical detail silently; validate against referenced instructions and bound length, no unsupported new quantities. Persist explanation/questions in care_task and render separately with provenance; existing tasks fallback honestly.
- POST /api/care-tasks/:id/feedback {text,expected_version} with idempotency/epoch/consent: atomically saves immutable self-report linked task/instruction revision and creates chat run. No automatic health fact confirmation; includes authorized original instruction and feedback in model context. Return run_id,source_id,conversation_id etc compatible with existing native chat handling. Task status change not diagnosis; feedback never edits instruction. Stale task can retain feedback with explicit stale provenance, no revive of task; foreign task denied.
- Export/delete includes new metadata/feedback/event state with dependent deletion, withdrawal/cancel and version checks unchanged.

## Tasks and ownership
- [x] Backend: services/api/domain-store.mjs, source-validation.mjs, domain-server.mjs and focused modules/tests. Implement contracts + regression tests; browser-discovered corrections tracked in integration.
- [x] Frontend: packages/client/* + apps/web/mobile JS/CSS + client tests. Four views, reconciliation controls, explanation/feedback flows on both widths.
- [x] Model/contracts: contracts schemas/OpenAPI, runtime/plugin schemas, five runtime Skills + approved-assets. Dedicated care-followup separates confirmed-instruction explanation from post-visit document extraction. Real extraction produces structured observations/comparisons and care explanations, no extra tools or diagnoses.
- [x] Integration: root reviewed coupling; 597/597 final tests, 108-module syntax checks and diff checks passed. Genuine Agnes synthetic document/profile/reconciliation/care/feedback flows exercised in desktop and 390px mobile browsers, including correction, deferred review, replacement, preserving an existing fact, task completion/pause/reopen, refresh, and subsequent chat turns. Eleven verified real runs completed; latest chat used zero repairs. Main app restarted with existing account/configuration/data.

## Review focus
- Missing vs denied, event time vs recorded time, measurement units and scores not fabricated.
- Concurrent review and conflicting multiple candidate replacements, partial/deferred review, superseded facts.
- Explanations cannot override source instruction; unknown drug/dose becomes question.
- Feedback retry and deletion cannot duplicate or resurrect sensitive input; across-owner references rejected.
- Browser reload, cross-device updates, old data without new fields remain usable.
