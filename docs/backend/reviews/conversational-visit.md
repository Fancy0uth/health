# Conversational visit generation — 2026-10-13

## Behavior

The desktop and mobile conversation surfaces no longer add a generation button after every reply. The health-assistant skill can offer a visit card within the dialogue, and the user confirms in a subsequent message. A verified confirmation creates one separate visit workflow on the server. The chat displays progress, failure guidance, or a small link to the completed card; generation does not navigate away from the conversation.

The confirmation is scoped to the current conversation, valid pending offer and latest distinct user source. A full affirmative grammar excludes information requests, deferred instructions, negations and quotations. Retrying an old confirmation after a newer refusal cannot revive consent. Runtime verification and continuation creation are atomic; unverified output, cancelled runs and repeated runtime receipts do not create duplicate visits.

The native client follows the server continuation and restores progress after reload. Failed child work is not presented as a failed chat or replayed by chat retries. Card links select the exact saved result. Accepted user messages remain visible while the timeline cache catches up.

The visit skill selects clinically relevant complete source sentences. Standalone interface/generation instructions are not report content. Clinical negation, uncertainty and source evidence remain intact.

## Verification

- Initial full suite: 430 passed, zero failures/skips. After adding the question-diagnostic regression: 430 passed, one existing 200ms readiness test timed out under concurrent real-model work; its complete jobs suite rerun passed 9/9. Syntax/JSON and whitespace checks pass.
- Independent review reproduced two accidental-confirmation paths; both fixed and independently rechecked with 21 confirmation tests.
- 117 frontend/native tests include pending/completed/failed continuation projection, reload, exact historical cards and immediate user-message retention.
- Reviewed runtime asset and frozen schema equality checks passed after both prompt updates.
- Real Agnes browser flow: desktop describes a synthetic scenario; assistant proposes generation; mobile continues same conversation and confirms with “好，就按刚才说的整理吧。”; card generation completes with verified runtime receipts. Mobile refresh retains status, and the small view link opens the actual card.
- All synthetic dialogue data uses an isolated QA database. The user's API key was explicitly authorized for persistent local setup and stored by Agnes ConfigurationService in the operating-system user data directory; no key was printed or committed.

- Real regeneration produced a clean speech with clinical duration and uncertainty preserved and standalone generation commands excluded. The conservative question guard now returns a field-specific repair instruction instead of a generic validation error; focused visit/asset tests pass 10/10.

- Regeneration interrupted by browser reload now persists its pending run and restores progress, then selects the new card only if the user has not deliberately selected another historical card. Real mobile reload-during-generation test completed and displayed the cleaned new card automatically. Final frontend focused suite: 120/120 passed.
