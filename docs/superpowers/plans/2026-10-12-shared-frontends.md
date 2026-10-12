# HealthThread Shared Frontends Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans. The user has authorized implementation and GitHub upload.

**Goal:** Organize two independent frontends around one runnable business API and an Agnes Harness SDK boundary, and upload the verified repository.

**Architecture:** apps/web and apps/mobile consume packages/client. A Node ESM service serves both apps and a revisioned SQLite prototype state API. An optional SDK adapter delegates model calls to an independently configured Agnes Harness runtime.

**Tech Stack:** Node >=24.10, native ESM and node:sqlite, original HTML/CSS/JavaScript, AGH @agnes/sdk public export.

**Spec:** docs/superpowers/specs/2026-10-12-shared-frontends-design.md

## Global Constraints

- Preserve both existing interfaces and assets; no frontend framework migration.
- No browser model keys and no model provider outside AGH.
- Unconfigured AI is an explicit error, never a fabricated real result.
- Keep original prototype semantics separate from future authenticated, field-level health APIs.
- Ignore runtime files, credentials and the unrelated video project.

## Review Focus

- Mobile modules must not depend on desktop private files.
- Concurrent saves must not overwrite a newer backend revision.
- Delete must propagate and must not re-seed sample medical data.
- A failed backend connection must preserve draft data and report failure.
- Unconfigured or cancelled AGH work must not be reported as completed.

## Task 1 Import and organize

- [x] Import desktop files to apps/web and mobile files to apps/mobile.
- [x] Move common demo data and chat adapter to packages/client; fix all paths.
- [x] Create root startup scripts and API contract documentation.

## Task 2 Shared backend and persistence

- [x] Write HTTP integration tests for dual static roots, shared state, restart persistence, optimistic conflicts, deletion and unavailable AI; observe failures.
- [x] Implement services/api/server.mjs and state-store.mjs with createHealthThreadServer({databasePath,agent}) and a revisioned state API.
- [x] Implement shared browser persistence and cross-tab/device refresh; test conflict/failure paths.
- [x] Run the full Node suite.

## Task 3 AGH integration boundary

- [x] Test adapter output parsing, noncompleted turns, cancellation and malformed outputs before implementing.
- [x] Implement SDK bundling through the public @agnes/sdk export and connect via supplied SDK options/socket.
- [x] Route original chat, record and document-text endpoints through AGH; fix mobile text parsing path.
- [x] Document model configuration and pending full workflow work.

## Task 4 Verification and upload

- [x] Verify modules/assets and both interfaces with the shared server; run full tests and syntax checks.
- [x] Review the final diff and address important findings.
- [ ] Commit only this task's files and push to the existing empty private origin.
- [ ] Verify the remote commit and return the repository URL with actual capability limits.
