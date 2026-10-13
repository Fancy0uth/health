# Judge distribution validation — 2026-10-13

## Scope

Self-contained Windows x64, macOS arm64 and macOS x64 archives contain Node.js 24.14.0, the pinned Agnes Harness runtime, approved HealthThread plugin/skills, local web/API code, launchers and licenses. No installation or terminal configuration is required for reviewers. Internet and a valid Agnes API key remain required.

## Verified

- Full suite: 395 tests passed, zero failures/skips before final stale-instance recovery change. Final recovery check is recorded below.
- Browser desktop: fresh launch-token login, unconfigured form, connection test, model selection, save, homepage transition, settings entry, saved status.
- Browser mobile at 390 × 844: settings entry, configuration change, model selection/save, return to `/mobile/`, re-open confirms selected model.
- Isolated official Host/ConfigurationService integration with scripted provider transport: persisted credentials, runtime hot switching, greeting completed through genuine SDK/Host tool path. This fixture does not prove remote inference.
- macOS arm64: extracted archive under a path with spaces, bundled Node only, no external harness checkout/dependencies. Health, setup, auto-login and SQLite creation outside app pass.
- All three archive manifests/checksums, official Node archive checksums, target executable architecture, source-file correspondence, credential/data exclusions verified.
- Launcher regressions cover symbolic paths, concurrent startup and partial descriptor visibility.

## Limits

Native Windows and Intel Mac execution was not available on this machine. Those targets have packaging/architecture verification, not end-to-end native execution. Build is unsigned and not notarized. Windows Script Host policies may require the included CMD fallback. Phone layout runs locally in the computer browser; the server is loopback-only and is not a mobile-network deployment.

## Real service validation

The user explicitly authorized a temporary use of the existing Agnes API key. The key is entered via the setup page of an extracted Mac archive and stored only in its isolated temporary data directory. No actual patient data is submitted. Results and credential cleanup are recorded below after completion.

Real validation passed on extracted macOS arm64 package: official connection test returned `agnes-3.0-flash`; browser save activated the runtime; synthetic prompt received a completed reply showing “Agnes 模型 · AGH 回执已核验”. After verified stop/restart, setup showed configured/ready and the prior two-message conversation remained. Temporary key handoff file was removed immediately after entry; isolated credentials and synthetic database were removed after final shutdown. Original account store was read only.

Review caught and fixed stale process-ID reuse recovery. Recovery is serialized, requires repeated refused connections and descriptor identity recheck, and never kills unrelated processes. Mismatched responding services and timeout cases are deliberately not reclaimed. Eight focused launcher regression tests pass.

Final validation: full suite **401 passed, 0 failed, 0 skipped**; the subsequently added incomplete-recovery-guard regression was run separately and passed (one additional case). Syntax/JSON and whitespace checks pass. Guard recovery records owner identity; dead-owner cleanup is checked, and live/incomplete ownership stops retrying at a finite deadline instead of looping forever. Eleven launcher tests are present.
