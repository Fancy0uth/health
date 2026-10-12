# Mobile subpage header CSS fix

Local commit: `eb5932d` — `fix: keep mobile subpage header readable`.

Scope: only `apps/mobile/styles.css` (one new selector, existing title selector extended). No shared domain/client behaviour, desktop styles, assets, model calls, service startup/reload, DB changes or browser interactions. No push/subagents. Commit used `--only apps/mobile/styles.css` with the requested command-local identity to preserve unrelated work.

Inspected `.runtime/acceptance/mobile-header-before-fix.png`, the actual 359-pixel phone screenshot, then `apps/mobile/styles.css`, the shared mobile shell in `packages/client/domain-ui.js`, and `packages/client/domain.css`. Actual shell class is `.app-header`, containing a direct shared `.button.secondary` return button and sibling `h1`.

Root cause: mobile's general `.button { width: 100%; }` supplies the header return button's full-row width. In the flex header, the title has no usable remaining width, so Chinese characters wrap vertically and clip. Existing `h1` already had `min-width: 0`, but lacked single-line overflow handling.

Changes:
- `.app-header > .button`: `width: auto; flex: none; white-space: nowrap` gives only the page-header button its content width while retaining its original touch height, padding, colour and border.
- `.app-header h1`: retain `flex: 1; min-width: 0`; add `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` so the title uses remaining header space horizontally and truncates only if needed.

The more specific header selector overrides the later general button width without altering form/card/action buttons or the desktop shell. No mirrored CSS tests were added for this reversible, low-impact change, as directed.

Verification:
- `npm run check`: exit 0, syntax/JSON checks passed for 66 JavaScript modules.
- `git diff --check -- apps/mobile/styles.css`: exit 0.
- Inspected the exact two-rule diff; no other tracked file changed in this fix.

Post-fix 359-pixel browser screenshot remains the coordinator's acceptance step. No live service/model attempt was made or automatic approval rejection bypassed.
