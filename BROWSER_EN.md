# Browser Backends

Jarvis's browser tool (`browser`) has two backends, selected by the **Target Browser** setting:

| Backend | What it is |
|---------|------------|
| `embedded` (default) | An embedded browser running in an isolated profile inside Jarvis (Electron `WebContentsView`). Cookies, logins, and site data stay separate from your everyday browser. |
| `system` | Your real, logged-in Chrome / Edge. Jarvis drives it through the browser's own remote debugging WebSocket endpoint (CDP), so the agent sees the pages and sessions you actually have open. |

`backend` lives in the cross-surface browser preferences (`shared/browser-preferences.ts`, default `embedded`). A session **freezes** the backend it started with: flipping the setting mid-session does not affect a session that is already running.

## Enabling the system browser

1. Turn on remote debugging in your browser: open `chrome://inspect/#remote-debugging` (or `edge://inspect` on Edge) and toggle it on.
2. Settings → Browser → **Target Browser**, and pick "My Chrome / Edge (logged-in)".
3. The first connection shows a permission prompt in the browser — click Allow. Jarvis never clicks that prompt for you.
4. **Check connection** reports whether an endpoint is ready: it returns, per channel (`chrome` / `edge`), whether a debugging endpoint was found. It is a plain file read and opens no connection.

## Implementation constraints

The system backend re-runs discovery before every connection, and does only this:

- **No hard-coded ports.** The browser picks its own port and writes it to `<user-data-dir>/DevToolsActivePort`; it is re-read before every connection because the port drifts (restarts, multiple instances, crash-and-relaunch).
- **Only `DevToolsActivePort` is read.** `Cookies` and `Login Data` are never touched, and the `/json/*` HTTP endpoints are not used (they are unavailable in this process; the WebSocket is the only channel).
- **Loopback only.** Endpoints always resolve to `ws://127.0.0.1:<port>/...`.
- **A missing or malformed file means "no endpoint right now"** — it returns `null` instead of throwing. A leftover or half-written file must not read as a crash.

## Consent and visibility

Every agent action on the system browser goes through the same consent and audit path as the embedded browser:

- **Action classification.** Each action is classified through `sessionPermission`: `snapshot` / `screenshot` / `scroll` / `wait` / `show` are `read`, `start` / `stop` are `routine`, and the rest (`navigate`, `click`, `type`, `select`, `key`, `evaluate`) are `review` — the session's permission mode decides whether each one needs your confirmation.
- **Reviewable targets.** `navigate` carries the normalized destination URL, and `click` / `type` / `select` / `key` / `evaluate` carry the exact `tabId`, so what you approve is "which tab, doing what".
- **Action log.** Each session keeps its 200 most recent actions (`action`, redacted parameter summary, result, URL at the time), across at most 20 sessions, for later review.
- **Unavailable always has a reason.** When a session becomes unavailable, `getBrowserSessionStates()`'s `unavailableReason` always carries an actionable reason (the `browser_status` event surfaces it as `error`) instead of an empty state.

## Boundaries

What the system backend deliberately does **not** do. These are intentional, not "not implemented yet":

1. **It never clears your real browser's cookies or site data.** "Clear cookies" only applies to the embedded browser; under the system backend the call fails outright: *"Clearing cookies and site data is only available for the embedded browser. Your system browser's data is never touched by Jarvis."*
2. **It never closes your tabs.** Jarvis only closes tabs it created itself (`owned`). Your tabs are only detached when a session closes or suspends — the pages stay in your browser exactly as they were.
3. **Suspending closes no tabs at all**, owned or not — every page goes back to you.
4. **It never clicks the browser's permission prompt for you.** A prompt that is never answered fails with `BROWSER_EXTERNAL_AWAITING_AUTH` / `BROWSER_EXTERNAL_AUTH_TIMEOUT` rather than working around it.
5. **Unknown commands fail loudly.** Commands the external backend does not implement return `BROWSER_EXTERNAL_UNSUPPORTED` — failing explicitly beats silently swallowing an agent action.
6. **The embedded browser's URL allowlist still applies.** A policy-blocked URL errors out; "it is the user's own browser" is not a reason to loosen the check.
7. **Plugins get no browser-control surface.** Plugins must not build ad hoc browser-control routes (see [`PLUGIN_SDK.md`](PLUGIN_SDK.md)); driving a logged-in site is the agent tool's job.

Connection / authorization failures (`BROWSER_EXTERNAL_NOT_RUNNING`, `_CONNECT_FAILED`, `_AWAITING_AUTH`, `_AUTH_TIMEOUT`, `_DISCONNECTED`) are **session-fatal**: no later action in that session can succeed, so it is marked unavailable with a reason. `BROWSER_EXTERNAL_UNSUPPORTED` and command timeouts fail a single command without taking the session down.

## Where the code lives

- Backend routing and preferences: `lib/browser/browser-manager.ts` (`_backendForSession`, `_getExternalBackend`, `clearBrowserCookiesAndSiteData`)
- External backend: `lib/browser/external/external-backend.ts`
- Endpoint discovery: `lib/browser/external/cdp-discovery.ts`
- CDP client and page scripts: `lib/browser/external/cdp-client.ts`, `lib/browser/external/page-script.ts`
- Preferences and routes: `shared/browser-preferences.ts`, `server/routes/preferences.ts`