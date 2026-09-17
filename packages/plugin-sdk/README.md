# @jarvis/plugin-sdk

Browser-side SDK for Jarvis WebView/iframe plugins.

```ts
import { jarvis } from '@jarvis/plugin-sdk';

jarvis.ready();
const logoUrl = jarvis.assets.url('images/logo.svg');
jarvis.ui.resize({ height: 320 });

await jarvis.toast.show({ message: 'Saved', type: 'success' });
await jarvis.external.open('https://example.com');
await jarvis.clipboard.writeText('Copied text');
await jarvis.resources.open({ resource: { kind: 'session-file', fileId: 'sf_1' }, mode: 'preview' });
```

## Assets

Use `jarvis.assets.url(path)` for files bundled under the plugin's `assets/` directory:

```ts
const js = jarvis.assets.url('dist/app.js');
const logo = jarvis.assets.url('/images/logo.svg');
```

The helper returns `/api/plugins/{pluginId}/assets/{path}` for the current iframe plugin. It accepts only relative, non-dotfile paths. Jarvis serves these resources through a path-scoped, HttpOnly asset session cookie, so Vite chunks, lazy imports, CSS, fonts, images, JSON, wasm, and browser-playable video files such as MP4 should live under `assets/`. The host asset route supports byte ranges for video playback.

Do not put secrets, source files, or source maps in `assets/`. Agent-generated plugins and newly edited plugin UI should not create custom route handlers just to serve static files such as CSS, JS, images, or MP4. Existing plugins that already expose static-file compatibility handlers remain loadable; treat the official `assets/` route plus `jarvis.assets.url(...)` as the documented contract for new work.

## Plugin API Routes

Use `jarvis.api.fetch(path, init)` when browser code calls this plugin's own route handlers:

```ts
const res = await jarvis.api.fetch('api/translate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ domain: 'football' }),
});
```

The helper builds `/api/plugins/{pluginId}/{path}` for the current iframe plugin and sends the `X-Jarvis-Plugin-Surface-Session` header from the iframe URL. Do not reuse `pluginIframeTicket` for `fetch()` calls, and do not hard-code `/api/plugins/{pluginId}/...` in browser code. `jarvis.api.url(path)` is available when you only need the current plugin route URL.

## Host Requests

Stable helpers are thin wrappers around `jarvis.host.request(type, payload)`.

| Helper | Capability | Grant |
| --- | --- | --- |
| `jarvis.toast.show(input)` | `toast.show` | no |
| `jarvis.external.open(input)` | `external.open` | yes |
| `jarvis.clipboard.writeText(input)` | `clipboard.writeText` | yes |
| `jarvis.resources.open(input)` | `resource.open` | yes |
| `jarvis.resources.pick(input)` | `resource.pick` | yes |
| `jarvis.resources.requestAccess(input)` | `resource.requestAccess` | yes |

Grant-required capabilities must be declared in `manifest.json`:

```json
{
  "manifestVersion": 1,
  "ui": {
    "hostCapabilities": ["external.open", "clipboard.writeText", "resource.open"]
  }
}
```

Browser-side resource helpers are host requests only. They can ask Jarvis to open
or reveal local/session/url resources, show the host picker, or request access,
but they do not expose direct filesystem read or write APIs inside the iframe.
Runtime code that actually reads or edits user resources should use
`ctx.resources` from `@jarvis/plugin-runtime`.

Do not mirror runtime ResourceIO operations into iframe code. The browser SDK is
for presentation and host-mediated actions; server-side plugin tools, routes, or
lifecycle code own the actual resource read/write path.

## Theme

Use `jarvis.theme.getSnapshot()` for initial theme data and `jarvis.theme.subscribe(callback)` for host theme updates. The host also passes `jarvis-theme` and `jarvis-css` query parameters for compatibility with simple iframe pages.
