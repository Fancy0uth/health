# Maintained health state implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task.

**Goal:** Model-maintained Chapter 4 health state document, automatically updated and shown clearly on both clients.
**Architecture:** Extend the existing immutable health_overview snapshot and entry/chat/document workflows with v2 problem/event understanding. Keep legacy domain compatibility, strict runtime receipts and source/current-revision validation. One native overview-only refresh upgrades existing data.
**Tech Stack:** Node 24, SQLite domain store, existing Agnes Harness tools, vanilla shared client renderer.
**Spec:** docs/superpowers/specs/2026-10-14-maintained-health-state.md

## Global Constraints
- Follow the spec's exact v2 shape and bounds, eight nullable dimension keys, seven existing body IDs and four qualitative statuses.
- No new model tool, no relaxed evidence/permission/receipt/repair budget, no JSON-string coercion.
- All source refs must be actually read and same-owner; edited superseded sources cannot support current assessment. Model synthesis is distinct from clinical confirmation.
- Existing workflows, APIs and legacy overview remain compatible. No tests that merely mirror CSS; no new dependencies.
- One production implementer at a time. Do not commit/push, edit credentials, restart services or use real model/browser in workers.

## Review Focus
1. Sparse first complaint must preserve nulls and permit natural dialogue without fabricated scores or health status.
2. An unrelated new complaint must not silently remove an active old problem.
3. Entire-record correction must stop superseded text from supporting current assessment.
4. Older/slower refresh cannot overwrite newer state; retries and legacy upgrade cannot loop or duplicate runs.
5. Uploaded tentative diagnosis, time-limited negation and planned treatment must retain provenance/time and remain distinct from reported execution.

### Task 1: Model document and automatic maintenance
**Files:** create services/api/health-state.mjs and tests/domain/health-state.test.mjs; modify automatic-records.mjs/domain-store.mjs/domain-server.mjs/agnes-agent.mjs as needed, workflow schemas, contracts and health assistant/record/post-visit skills; regenerate checked assets with existing scripts.
**Interfaces:** existing profile.health_profile.overview now exposes v2 fields plus snapshot metadata; POST /api/health-profile/refresh accepts operation_key and returns run_id/status (or clear no-data result). Existing retry endpoint handles failed overview-only runs. Legacy currentOverview/read and summary/regions input compatible.
- [ ] Write meaningful failing domain tests for v2 shape/source bounds, complete snapshot versioning, retained previous keys, edit supersession and legacy reads.
- [ ] Implement isolated v2 validation/context/persistence; retain medical uncertainty and immutable facts; no blind server narrative merge for v2.
- [ ] Write refresh tests: consent, ownership, no data, idempotency, already pending, failed restart/retry, snapshot race and no fake change ID.
- [ ] Implement explicit overview-only refresh using existing workflow and queue/retry semantics; active tools advertise native v2 while public contracts remain backward compatible.
- [ ] Run focused compatibility/domain/actual SDK tests and regenerate runtime/OpenAPI assets. Write task-1-report.md including paths, commands, outputs and test red/green evidence. Pause production edits.

### Task 2: Readable desktop/mobile document views
**Files:** shared health-profile.js/health-profile.css, domain-client.js/native-bridge.js, web/mobile app routing as required; tests/client/health-state.test.mjs.
**Consumes:** Task1 v2 projection + refresh method and current progress/retry fields. **Produces:** main profile overview shows assessment problem cards, collapsible eight-dimension explanation, background/uncertainty, source links and version.
- [ ] Add failing renderer/bridge tests for v2 display, nulls, escaping, stable disclosures, refresh single submission, consent/no data/failure and legacy upgrading.
- [ ] Implement shared pure renderer and native refresh actions; auto-upgrade once when profile is opened with consent and saved data, no repeated failure loop. Legacy stays honest; existing source/record/event/review actions remain reachable.
- [ ] Preserve existing control vocabulary and explicitly use phone narrow layout; render ended problems in a separate collapsible section and substantive context without dumping all records into summary.
- [ ] Run relevant client tests; write task-2-report.md and pause production edits.

### Task 3: Integration and genuine acceptance
**Files:** controller-owned QA scripts/synthetic data and evidence in this plan's ignored workspace only. No production edits outside one delegated bounded fix if evidence identifies a defect.
- [ ] Scoped independent reviews after Tasks1/2 using saved diff packages; fix only established failures before proceeding.
- [ ] Run real model and browser with authorized existing local Agnes config and synthetic account, checking first complaint, subsequent detail/new region, uploaded report, feedback and edit; inspect saved structured document version and evidence as well as UI.
- [ ] Run final full npm test/check and diff checks once stable. Save screenshot proof; keep prior failed-run evidence honest.
- [ ] Back up/restart local main project retaining account/config and open both clients; no push unless user asks for this revision.
