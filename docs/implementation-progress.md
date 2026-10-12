# Implementation progress

Plan: docs/superpowers/plans/2026-10-12-shared-frontends.md

- User authorized reorganization and upload after reviewing the shared-backend architecture in conversation.
- Existing repository is unborn; worktree creation needs a base commit, so work in place on codex/healththread-shared-backend. The unrelated video project is ignored and excluded from commits.
- GitHub connector cannot access the private repository, but authenticated gh works outside the network sandbox. Use git/gh for upload.
- Scope is a shared-backend-ready organization and runnable prototype persistence, not the complete medical Agent system.
- Tasks 1–3 complete: independent apps imported; shared SQLite/API and optional public AGH SDK adapter implemented. Public SDK bundle built and exports checked against fixed local harness.
- Independent final review found three important races. Fixed all with regression tests: profile generation invalidation/cancellation, dirty-form polling guard, and recovered unsynced drafts without automatic replay.
- Full suite with the fixed AGH source: 22 tests passed. Syntax/JSON check: 21 JavaScript modules passed. node:sqlite emitted the documented experimental warning.
- Browser verification: mobile saved a synthetic record with unknown date; desktop received it and showed it on the timeline with “未记录”. Both pages loaded and console error lists were empty. AI remained explicitly unconfigured during UI verification.
- No unresolved review findings. Formal auth, evidence validation, PDF and complete medical workflows remain outside this organization task and are documented in README and next-pipeline.

- Additional runtime checks fixed CommonJS builtin loading in the SDK bundle and queued cancellation, each verified RED→GREEN.
