# Native login and assistant correction — 2026-10-12

Scope: retain original desktop/mobile page layouts and their existing CSS/assets. Add a separate, scoped login stylesheet using the existing logo/colors, real account display and logout. Connect the original home assistant to a dedicated source-backed AGH workflow.

## Reproduced causes and corrections

- Initial login was an unstyled dialog, desktop used the mobile button class, and mobile lacked an account/logout entry. Both platforms now have an explicit branded login screen and current account controls. Same-origin web/mobile intentionally share login cookies. Wrong-password feedback and correct-login/account-sharing were checked in the actual browser; desktop logout returned both platforms to login.
- `DomainClient.submit` emitted an operation event without its operation. The original-page subscriber dereferenced `event.operation.state`, throwing before POST. A regression reproduced this failure; every operation event now carries the operation, with a defensive optional check in the subscriber.
- Desktop asynchronous replies mutated a session object replaced by canonical refresh. Completion now writes the current session, ignores missing/deleted sessions and deduplicates the same stored run.
- The assistant endpoint previously used W2 visit preparation and returned only its verbatim speech. It now uses `health-assistant` / `chat` / `assistant_reply`, with the existing five-tool boundary. Questions and patient quotes are validated, persist in backend results and are reconstructed across clients. Product framing is interface copy; source claims remain extractive. No automatic confirmation, diagnosis, card or care task is produced by chatting.
- Staging precedes SDK completion. Real-mode waiting now waits for the final runtime metadata or explicit execution error before the verified badge. Unknown requests recover under their original key, preserving the local conversation association.

## Verification

- RED/GREEN regression artifacts: `.runtime/acceptance/operation-event-{red,green}.log`, `chat-persistence-{red,green}.log`, and `auth-chat-red.log`.
- Final full configured test suite: **226/226 passed**, zero failed/skipped/cancelled; syntax/JSON **72 modules**. `.runtime/acceptance/auth-chat-tests-final.log`.
- One additional real UI acceptance request, nonclinical question: “你好，请问你能帮我整理哪些资料？” No batch evaluation rerun, no retries against a failed remote run. The initial local failure sent no POST; explicit recovery used the original request key.
- Real run `run_b67dfd78-1948-4cbd-bf20-5335bff53c6f` completed through `agnes-ai / agnes-3.0-flash`, SDK session `healththread:d90cef0c-6446-4743-8528-4a9c0b1abb92`, `last_seq=78`, three correlated read/retrieve/stage receipts, `completed/end_turn`, zero repairs and no execution error. See `.runtime/acceptance/native-chat-real-receipt.json`.
- Desktop displayed the reply and verified badge after reload. Mobile read the same saved two-message conversation and badge. Screenshots: `web-chat-real.png`, `mobile-chat-real.png`, `web-login.png`, `mobile-login.png`, under `.runtime/acceptance/`.

The one real case proves this request chain, not general medical correctness or transport reliability. Existing frozen V2 quality records are unchanged and apply to their evaluated code/assets. Generic diagnosis, treatment and D01/D02 judgments remain outside the configured product scope; exact-source validation is a finite mechanical constraint.

## Focused review and dispositions

A read-only reviewer found two P2 issues: completed-history projection removed an unfinished/failed follow-up; older results lost conversation grouping outside the latest 100-run page. Both were reproduced in `chat-review-red.log` and corrected in `chat-review-green.log`. Projection now merges canonical turns with the unmatched local follow-up/error, and results carry durable server-owned conversation metadata. Initial chat results receive metadata on database reopen without changing content. A reopen regression checks content preservation. No other concrete P1/P2 was found in auth/logout, original-key recovery, ownership or confirmation boundaries. Broader UI redesign and medical expansion were out of this correction's scope.
