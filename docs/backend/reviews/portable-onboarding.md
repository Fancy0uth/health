# Portable Agnes onboarding verification — 2026-10-13

Scope: a teammate can install the pinned Harness, configure their own Agnes API key, verify a real conversation, and run both existing frontends without developer-specific paths.

Changes:
- Project-relative defaults for Harness source, account home, and runtime home. Explicit external overrides remain supported.
- `npm run setup`: preserves existing `.env`, otherwise creates a local synthetic login; installs the exact upstream commit and locked pnpm dependencies; builds the genuine Host/SDK bundle.
- `npm run configure:agh`: hidden key prompt, real provider catalogue, explicit model selection and save through the public Host ConfigurationService. Refuses to overwrite configured profiles. The key is never an argument or committed file.
- Default startup fails with setup instructions if real model dependencies are unavailable. `AGENT_MODE=disabled` remains explicit.
- `verify:agh-runtime` checks readiness without inference; `verify:chat` exercises the actual HTTP chat API with a synthetic account/database and requires completed SDK correlations, not merely a staged reply.

Verification performed on macOS, Node 24.14.0:
1. Copied the candidate tracked tree to an isolated checkout without the original `.env`, `.runtime`, account home, or installed dependencies.
2. Installed official upstream commit `7819b23c249fe47ce14bd89e3982e17986e3e197` and pnpm `10.34.5` dependencies; built the runtime successfully. Also installed a second independent source using the shallow fixed-commit fetch path.
3. Configured an independent account home via the new configuration command. The user explicitly authorized using their existing Agnes key solely for this isolated verification. No credentials were committed or printed.
4. Readiness check passed. A real synthetic chat through `/api/health-assistant` completed on `agnes-3.0-flash`, with no execution error and three correlated SDK tool receipts.
5. Started the isolated application. Both `/web/` and `/mobile/` returned 200, the generated local account logged in successfully, and health reported real analysis enabled.

Final candidate validation in the isolated checkout: **374 tests passed, zero failures, zero skips**. Syntax/JSON checks passed for 89 JavaScript modules. Repeated setup preserved the local configuration and reused the valid checkout.

Regression coverage includes missing Harness fail-fast startup, project-relative paths, existing-setting preservation, credential redaction and cancellation, genuine Host credential persistence, exact-source pinning, dirty-checkout protection, interrupted-install recovery and pinned package-manager invocation. This is not native Windows/Linux execution evidence; their prerequisites and installed provider connectivity still matter. Upstream source download, registry access, an Agnes API key and model quota are external prerequisites, not bundled credentials.
