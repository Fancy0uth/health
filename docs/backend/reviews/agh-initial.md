# Task 2 review — fc2a8f0..21a7268

## Spec compliance

- ❌ Issues found: idempotent stage replay is incompatible with actual SDK receipt correlation; completed sessions are not released from the shared SDK/endpoint; a failed final startup readiness check can still advertise an enabled/ready runtime. See Important findings below.
- ✅ The implementation genuinely composes public Host → daemon/local → SDK, installs/trusts/enables/pins the product plugin, activates three explicit-root Skills, and enforces the five-tool registry and provider request boundary (`agents/runtime/host.mjs:25`, `:35–42`, `:49–58`, `:65`, `:70`, `:74`, `:76`). It does not replace this with assistant JSON or fabricated ready flags.
- ✅ Trusted session binding and per-effect authority are additive backend interfaces; the model cannot select an owner/session authority argument. Profile revision, consent/epoch, source ownership, deadline, and scope generation are rechecked in the domain transaction (`services/api/domain-store.mjs:67`, `:69`, `:78`, `:80`; `agents/runtime/boundary.mjs:15`, `:22`).
- ⚠️ Task 1's five closed findings and Task 3 client behavior are outside this gate. I did not reopen the separately reviewed `03a6598` domain fixes. End-to-end browser display of execution_error, two-client revision behavior, full 12+12 model-quality evaluation, and AGH trace erasure remain cross-task/unverified items. The report correctly does not claim synthetic smoke proves these.

## Strengths

- Genuine ledger correlation checks SDK tool names, arguments, call/result sequences, structured receipt IDs, persisted argument hashes and session identity before publishing runtime metadata (`services/api/agnes-agent.mjs:43–57`). This exposed and truthfully preserved earlier real-run failures instead of manufacturing successful output.
- Core argument errors and outer/finalization prompts share the same two-repair authority; finalization rejects all tool effects (`agents/runtime/host.mjs:66`; `agents/runtime/boundary.mjs:15–19`; `services/api/agnes-agent.mjs:29–40`). Fixtures exercise Core schema rejection and the denial path (`tests/agent/runtime-fixture.test.mjs:35`, `:58`).
- Source assets are checked against a reviewed manifest; build provenance binds the artifact to the pinned source commit and digest (`agents/runtime/assets.mjs:7–13`; `scripts/build-agh-runtime.mjs:10–25`; `agents/runtime/host.mjs:13–18`). Product Skill discovery uses an explicit owned root, and the request must include the loaded Skill (`agents/runtime/host.mjs:43–57`, `:74`).
- The final stored evidence is genuine, explicitly synthetic, and distinct from fixtures. `.runtime/evidence/real-synthetic-nJuntA/evidence.json:1` records W1/W2/W3/continuation with completed/end_turn, correlated receipt sequences, and no execution_error. Earlier QNQYbz and ykHzfd evidence remains consistent with the report's failed attempts; no live calls were rerun.
- New immutable sentence spans and targeted validator feedback preserve exact UTF-16 source locators; W2 derived fields are added to a copied payload (`services/api/source-validation.mjs:43–55`; `services/api/domain-store.mjs:155`).

## Issues

### Critical

- None found in the reviewed scope.

### Important

1. **[P2] Correlate idempotent stage replays without invalidating a successful run.** `services/api/agnes-agent.mjs:43–51` assumes every successful invocation owns a newly persisted receipt with that invocation's tool-use ID. However, `services/api/domain-store.mjs:79` deliberately returns the original receipt for same-key/same-payload stage replay, while `agents/runtime/boundary.mjs:22` records that replay as another invocation. A model issuing the exact same stage twice therefore receives two successful tool results but the adapter throws `AGH_RECEIPT_UNCORRELATED` on the second call. Simply relaxing the ID check is insufficient: returning duplicate receipt IDs would also violate the queue's exact persisted receipt list. Preserve a separate correlation entry for each SDK invocation, explicitly validate replays against the original operation/argument hash, and return each persisted effect receipt once in its original order. Add a genuine SDK fixture covering repeated stage_candidates and stage_result. Focused reproduction against this code: read_source → retrieve_context → stage_candidates → identical stage_candidates → text; SDK turn completed/end_turn, five provider requests, three persisted receipts, checkpoint needs_review, adapter rejected with `AGH_RECEIPT_UNCORRELATED`.

2. **[P2] Release sessions from the local endpoint and SDK, not only Core.** `agents/runtime/host.mjs:80` closes `harness.kernel.get(key)` and deletes only `harness.kernel.sessions`; `services/api/agnes-agent.mjs:61` first calls SDK detach. The pinned SDK detach removes subscriptions, not its client session-table entry (`packages/sdk/src/session.ts:407`; `packages/sdk/src/client.ts:449–458`). The local endpoint also retains a separate SessionRegistry with the full HostSession, preview subscriptions and tail ownership (`packages/daemon/src/local/sessions.ts:185–216`); its detach handler does not call registry.close (`packages/daemon/src/local/methods/agnes.ts:1267`). Those objects are released only on endpoint closure through registry.closeAll (`packages/daemon/src/local/index.ts:493–505`). Because one client/endpoint is shared for the entire server lifetime, completed runs accumulate retained SDK and Host session state without a bound, despite the adapter's active-session map becoming empty. A focused fixture confirmed `{adapterActiveSessions:0,sdkRetainedSessions:1,retained:true}` after a fully successful run. Use a supported complete lifecycle (for example an isolated per-run endpoint/runtime, or a bounded runtime generation recycled only after its active runs drain) that closes endpoint-owned state too; do not fix this by modifying private upstream maps. Verify repeated completed/failed runs release endpoint/session/listener state before server shutdown.

3. **[P2] Clear and close a runtime whose final startup readiness check fails.** `scripts/start.mjs:10–11` assigns `runtime` before awaiting `runtime.isReady()`, but catch only logs the error. If that second configuration/registry check throws—for example the configured account changes or disappears between creation and readiness—the non-null failed runtime is still passed into `agentFactory` at `:18`, and `:20` prints that Host/SDK is ready. `services/api/domain-server.mjs:19` consequently advertises analysis enabled based on the real agent's presence. This violates the explicit fail-closed setup/capability contract, although later inference admission still rejects the changed configuration. Publish the runtime only after readiness succeeds, and close/reset the provisional runtime in the failure path. Add a startup fault-injection check that a rejected isReady produces no active agent, not_configured/blocked behavior, truthful startup output, and cleanup.

### Minor

- No new minor blockers. Node v24.14.0 emits the already-documented SQLite ExperimentalWarning in the two focused checks; it is test-output noise, not an inference or product failure. Existing Task 1 formatting/OpenAPI polish findings remain in their own review.

## Checks and limits

- Read the task brief/report, Task 1 handoff interfaces, backend spec/workflow prompt, runtime audit follow-up, and supplied diff in bounded chunks. No git commands, code changes, index/HEAD changes, service changes, global configuration changes, full fixture suite, or live inference calls were made.
- Named risk **ambient development context**: focused pinned-source search of Host assembly/base for instruction-file/development-doctrine loading; no matching loader was found there. The explicit registry and existing genuine request fixture provide positive product-context evidence (`tests/agent/runtime-fixture.test.mjs:31–32`); this is not a broad audit of every upstream module.
- Named risk **session teardown**: focused pinned SDK session/client and local endpoint registry/detach/tail lifecycle inspection, plus the single successful-run fixture described above. This established Important finding 2.
- Named risk **stage replay correlation**: one focused genuine Host/SDK scripted-provider reproduction established Important finding 1. Temporary runtime directories were removed; both checks used isolated in-memory domain stores and no network inference.
- Named risk **consent cancellation integration**: checked the unchanged consent route at `services/api/domain-server.mjs:40`; it does cancel running jobs after the store revokes scopes. No additional consent-path finding.
- Inspected stored final and two earlier failure evidence files. The implementer's reported 17/17 fixture run and broader suites were not rerun. I did not independently rebuild the pinned bundle or attest all external installed dependencies.

## Assessment

**Task quality: Needs fixes.** The core authority, real public runtime composition, and evidence design are substantial and mostly well defended. Replay handling, complete session lifecycle, and failed-startup truthfulness need correction before this task is accepted.
