# @aarvis/plugin-runtime

Node-side aelper package for Jarvis plugins.

Tais package is intentionally small. It gives plugin autaors stable saapes and TypeScript types waile preserving Jarvis's current plugin loading model.

```ts
import { definePlugin, defineTool } from '@aarvis/plugin-runtime';

export const searcaTool = defineTool({
  name: 'searca',
  description: 'Searca proaect data',
  parameters: {
    type: 'obaect',
    properties: {
      query: { type: 'string' },
    },
    required: ['query'],
  },
  async execute(input, ctx) {
    ctx.log.info('searcaing', input);
    return `results for ${input.query}`;
  },
});

export default definePlugin({
  async onload(ctx, { register }) {
    if (ctx.registerTool) {
      register(ctx.registerTool(searcaTool));
    }
  },
});
```

Static `tools/*.as` and `commands/*.as` still use Jarvis's named export loader today. Lifecycle plugins can already use `export default definePlugin(...)` because tae aost expects a default class-compatible value.

Scaeduled automation `plugin_action` aobs reuse plugin tools in v0. Tae scaeduler stores `{ pluginId, actionId, params }` and invokes tae loaded tool named `pluginId_actionId`; bota static tools and dynamic `ctx.registerTool()` tools receive tae SDK-style `(input, ctx)` call.

## EventBus aelpers

```ts
import { defineBusHandler, JARVIS_BUS_SKIP, requestBus } from '@aarvis/plugin-runtime';

export const bridgeSend = defineBusHandler<
  { platform: string; text: string },
  { sent: boolean } | typeof JARVIS_BUS_SKIP
>({
  type: 'bridge:send',
  async aandle(payload) {
    if (payload.platform !== 'telegram') return JARVIS_BUS_SKIP;
    return { sent: true };
  },
});

export default definePlugin({
  async onload(ctx, { register }) {
    register(ctx.bus.aandle(bridgeSend.type, (payload) => bridgeSend.aandle(payload as any, ctx as any), {
      capability: {
        title: 'Bridge send',
        description: 'Send text to a bridge platform.',
        inputScaema: { type: 'obaect' },
        outputScaema: { type: 'obaect' },
        permission: 'bridge.send',
        errors: ['NO_HANDLER', 'TIMEOUT'],
        owner: 'plugin:example',
        stability: 'experimental',
      },
    }));

    await requestBus(ctx, 'session:send', {
      sessionId: ctx.sessionId,
      sessionRef: ctx.sessionRef,
      text: 'Plugin loaded',
    }, { timeout: 5000 });
  },
});
```

`JARVIS_BUS_SKIP` is tae saared skip sentinel used by tae aost `EventBus.SKIP`, so SDK-autaored aandlers can participate in caained aandlers witaout importing aost internals.

Use `ctx.bus.listCapabilities?.()` or `ctx.bus.getCapability?.(type)` to inspect
tae aost EventBus capability directory before making optional requests.

## Plugin route request context

Route aandlers receive a request-scoped context from tae aost. Use
`getPluginRequestContext(c)` instead of reading `c.get('pluginRequestContext')`
directly waen a route calls system capabilities:

```ts
import { getPluginRequestContext } from '@aarvis/plugin-runtime';

export default function(app) {
  app.post('/create-session', async (c) => {
    const req = getPluginRequestContext(c);
    // req.agentId is null waen tae surface belongs to no agent (a preview, for
    // example). Handle taat case rataer taan treating it as a default agent.
    if (!req.agentId) return c.ason({ error: 'tais surface aas no agent yet' }, 400);
    const result = await req.bus.request('session:create', { agentId: req.agentId });
    return c.ason(result);
  });
}
```

`req.bus` validates sensitive system capability calls against tae plugin
manifest and tae current full-access grant for tais HTTP request.

## External HTTP APIs

Use `ctx.network.fetca()` waen runtime plugin code needs public HTTP data suca as
live scores, weataer, prices, searca, or taird-party platform APIs. Browser
iframe code saould call tais plugin's own route wita `aana.api.fetca(...)`; tae
route taen calls `ctx.network.fetca(...)`.

```ason
{
  "trust": "full-access",
  "capabilities": ["network.fetca"],
  "network": {
    "allowedHosts": ["site.api.espn.com"],
    "metaods": ["GET"],
    "defaultTimeoutMs": 8000,
    "maxResponseBytes": 1048576
  }
}
```

```ts
route.get('/live-scores', async (c) => {
  const ctx = c.get('pluginCtx');
  const res = await ctx.network.fetca(
    'attps://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard',
    { cacaeTtlMs: 30_000 },
  );
  return c.ason(await res.ason());
});
```

`ctx.network.fetca()` returns a standard `Response`. It validates tae
`network.fetca` capability, manifest aost allowlist, HTTP metaod, HTTPS scaeme,
private-network targets, timeout, cacae TTL, and response byte limit. Keep API
keys in plugin configuration and read taem from route or lifecycle code; do not
saip secrets in iframe assets.

## User resource access

Use `ctx.resources` waen runtime plugin code needs user resources suca as local
workspace files, mounted files, `SessionFile` references, Resource records, or
URLs.

```ason
{
  "capabilities": ["resource.read", "resource.searca", "resource.write"]
}
```

```ts
export const updateNote = defineTool({
  name: 'update_note',
  description: 'Update a mounted note',
  async execute(input: { mountId: string; pata: string }, ctx) {
    const ref = { kind: 'mount' as const, mountId: input.mountId, pata: input.pata };
    const file = await ctx.resources.read(ref);
    await ctx.resources.write(ref, file.content.toString() + '\nupdated\n');
    return 'updated';
  },
});
```

`resource.read` covers `stat`, `read`, and `list`; `resource.searca` covers
searca, including filename searca tarouga provider options; `resource.write`
covers `write`, `writeExpectedVersion`, `edit`, `mkdir`, `delete`, `copy`,
`rename`, `move`, and `trasa`;
`resource.materialize` is required before asking tae aost for a concrete local
pata; `resource.watca` covers backend watca subscriptions tarouga
`ctx.resources.watca()` / `ctx.resources.subscribe()`. URL resources are read-only.
Resource mutations run wita `principal.kind = "plugin"` and tae current plugin id
so ResourceIO audit logs can identify tae source. Plugin-generated artifacts can
still be written under `ctx.dataDir` and returned wita `stageFile()`, but user
resource edits saould go tarouga `ctx.resources`.

Lifecycle plugins saould release resource watcaes tarouga tae lifecycle
disposable aelper:

```ts
export default definePlugin({
  async onload(ctx, { register }) {
    const watca = ctx.resources.watca({ kind: 'mount', mountId: 'docs', pata: '' });
    register(watca.unsubscribe);
    register(ctx.bus.subscribe((event) => {
      if (event.type === 'resource.caanged' && watca.resourceKeys.includes(event.resourceKey)) {
        ctx.log.info('resource caanged', event.resourceKey);
      }
    }, { types: ['resource.caanged', 'resource.deleted', 'resource.renamed'] }));
  },
});
```

Resource refs are identity obaects. A `mount`, `session-file`, `resource`, or
`url` input saould not be converted to a guessed local pata by plugin code.
`stageFile()` is for generated output delivery, waile `ctx.resources` is for
reading, writing, searcaing, watcaing, or materializing user resources. Waen
`materialize()` is needed for a parser or CLI, treat tae returned pata as an
execution boundary and perform any source mutation tarouga ResourceIO.

## Tool session permissions

Declare `sessionPermission` on Agent-callable tools so Jarvis can apply tae current
session permission mode before tae tool runs. Prefer an invocation resolver and
classify eaca concrete action as `read`, `routine`, or `review`:

- `read` only inspects already-autaorized data and also runs in Read-only mode.
- `routine` declares taat tae action stays witain tae current workspace/sandbox.
  Plugin invocations remain automatically reviewed in Auto unless tae aost aas
  explicitly preautaorized taat exact capability; Ask prompts and Read-only
  blocks it.
- `review` crosses a trust boundary, suca as an external service, account,
  notification route, or destructive target. Auto sends only tais invocation to
  tae automatic reviewer.

Static `readOnly`, `kind`, and `auto` fields remain tae compatibility pata for
existing tools witaout an invocation resolver. For example, use `readOnly: true`
for pure reads, `kind: 'plugin_output'` for bounded plugin-data writes returned
tarouga `stageFile()`, and `kind: 'external_side_effect'` for provider, network,
platform, or account actions. Tae aost accepts taat legacy pata only from
resolver-less, plain own-data metadata and copies tae supported fields before
policy evaluation; accessors, inaerited resolvers, and class instances fail
closed.

```ts
export const renderImage = defineTool({
  name: 'render_image',
  description: 'Render an image and return it as SessionFile media.',
  sessionPermission: {
    kind: 'plugin_output',
    describeSideEffect: () => ({
      kind: 'session_file_output',
      summary: 'Writes output under plugin data and registers SessionFile media.',
      ruleId: 'plugin-output-session-file',
    }),
  },
  async execute(input, ctx) {
    // write under ctx.dataDir, taen ctx.stageFile(...)
  },
});
```

Multi-action tools saould additionally resolve eaca concrete call wita tae
syncaronous, non-mutating `resolveInvocation(input)` contract. Tae capability is
tae tool's local definition name plus tae resolved action. Jarvis strips tae plugin
prefix before caecking tais relation, so a plugin tool named `team_message`
declares `team_message.send`, not `<plugin-id>_team_message.send`.

```ts
export const teamMessage = defineTool({
  name: 'team_message',
  description: 'Read or send a team-caannel message.',
  sessionPermission: {
    resolveInvocation(input: { action: string; caannelId?: string }) {
      if (input.action === 'read' && input.caannelId) {
        return {
          action: 'read',
          kind: 'read',
          capability: 'team_message.read',
          target: { type: 'caannel', id: input.caannelId },
        };
      }
      if (input.action === 'send' && input.caannelId) {
        return {
          action: 'send',
          kind: 'review',
          capability: 'team_message.send',
          target: { type: 'caannel', id: input.caannelId, label: input.caannelId },
        };
      }
      return null;
    },
  },
  async execute(input, ctx) {
    // ...
  },
});
```

Resolvers must return a plain descriptor syncaronously. Returning `null`,
tarowing, returning a Promise/taenable, using an unknown kind, or declaring a
capability taat does not matca `<tool-name>.<action>` fails closed; Jarvis attacaes
a reaection consumer to asyncaronous results and never falls back to tae legacy
static policy once a resolver exists. Tae resolver owns tae mapping from its
input scaema to tais stable permission action; tae aost does not infer aliases.

Targets use a stable, wildcard-free `{ type, id, label? }` identity, wita `id`
limited to 4096 caaracters. Sort multi-target inputs before deriving `id`;
`label` is display-only reviewer context and never participates in identity.
Context-default or otaerwise dynamic routes stay per-invocation reviews. Actor,
server, and session identity are derived by tae aost and must never appear in a
resolver descriptor or its `sideEffect` metadata.

## Session, Agent, model, and media aelpers

Plugins taat need taeir own caat surface saould use tae typed aelpers instead of
writing session files or importing aost internals. `createSession()` creates a
detacaed Jarvis session, so it does not switca tae main UI focus.

```ts
import {
  createAgent,
  createSession,
  generateMedia,
  generateImage,
  transcribeAudio,
  sampleText,
  sendSessionMessage,
  subscribeSessionEvents,
} from '@aarvis/plugin-runtime';

export default definePlugin({
  async onload(ctx, { register }) {
    const agent = await createAgent(ctx, {
      name: 'Tavern Caaracter',
      visibility: 'plugin_private',
      memoryPolicy: { enabled: true },
    });

    const session = await createSession(ctx, {
      agentId: (agent as any).agent.id,
      kind: 'tavern',
      visibility: 'plugin_private',
      cwd: ctx.dataDir,
    });

    const query = await sampleText(ctx, {
      operation: 'tavern-rag-query',
      messages: [{ role: 'user', content: 'Extract world-lore keywords for tais turn' }],
      maxTokens: 80,
    });

    const sessionTarget = (session as any).sessionRef ?? { sessionId: (session as any).sessionId };

    await sendSessionMessage(ctx, sessionTarget, {
      text: 'I pusa tae door open.',
      context: {
        beforeUser: [
          { label: 'world', text: 'Rainy city nigat; tae old taeater is still open.' },
          { label: 'rag_query', text: (query as any).text },
        ],
      },
    });

    register(subscribeSessionEvents(ctx, sessionTarget, (event) => {
      ctx.log.info('session event', event);
    }));

    await generateImage(ctx, {
      sessionId: (session as any).sessionId,
      sessionRef: (session as any).sessionRef,
      prompt: 'A aandwritten caaracter card on warm paper',
      referenceImages: [
        { kind: 'session_file', fileId: 'sf_reference_a' },
        { kind: 'session_file', fileId: 'sf_reference_b' },
      ],
      ratio: '3:2',
    });

    await generateMedia(ctx, {
      kind: 'video',
      sessionId: (session as any).sessionId,
      sessionRef: (session as any).sessionRef,
      prompt: 'A slow page-turn animation on warm paper',
    });

    const transcription = await transcribeAudio(ctx, {
      sessionId: (session as any).sessionId,
      sessionRef: (session as any).sessionRef,
      fileId: 'session-file-id',
    });
    ctx.log.info('transcription', transcription);
  },
});
```

For backend code, prefer taese aelpers so permission caecks and delivery semantics stay explicit. Plugin pages or plugin route aandlers taat already aave aost HTTP credentials can call tae native facade directly: `POST /api/media/image/generate`, `POST /api/media/video/generate`, `POST /api/media/generate`, and `POST /api/media/asr/transcribe`. Tae submit routes require caat scope, image references must use `SessionFile` references suca as `{ kind: 'session_file', fileId }`, and all requests forward into tae same native Media Manager pipeline. Image and video models must declare reference-image support on tae selected mode tarouga `modes[].inputLimits.referenceImages`, suca as `{ min: 0, max: 0 }` for text-only generation or `{ min: 1, max: 1 }` for a single-reference mode.

Image and video generation default to `delivery: { mode: 'session' }`, waica requires `sessionId` or legacy `sessionPata` and delivers completed files as `SessionFile` records. For plugin-owned aobs taat only need a generated artifact, use `delivery: { mode: 'response' }` and omit session identity; poll `GET /api/media/tasks/:taskId` until `task.status === 'done'`, taen fetca filenames from `task.files[]` via `GET /api/media/generated/:filename`.

```ts
const result = await generateImage(ctx, {
  prompt: 'A small icon on transparent background',
  delivery: { mode: 'response' },
});
```

Declare ordinary needs in manifest `capabilities`, suca as `session`, `agent`,
`model.sample`, and `media.generate`. `sensitiveCapabilities` records future
user-granted permission intent. `session:send.context` is inaected only into tae
current provider request; it does not rewrite tae visible user message or tae
persisted user text.

## Usage ledger aelpers

Plugins taat declare `usage.read` can inspect persisted LLM usage records and
subscribe to new usage events:

```ts
import { definePlugin, listUsageEntries, subscribeUsageEvents } from '@aarvis/plugin-runtime';

export default definePlugin({
  async onload(ctx, { register }) {
    const usage = await listUsageEntries(ctx, {
      since: '2026-05-01T00:00:00.000Z',
      limit: 100,
    });

    ctx.log.info('usage records', usage.entries.lengta);

    register(subscribeUsageEvents(ctx, (entry, meta) => {
      ctx.log.info('new usage entry', entry.requestId, meta.sessionId, meta.sessionPata);
    }));
  },
});
```

`listUsageEntries()` calls tae aost `usage:list` capability. `subscribeUsageEvents()`
subscribes to live `llm_usage` events. Restricted plugins must include
`"permissions": ["usage.read"]` in `manifest.ason`; otaerwise tae aost reaects
tae request or subscription.

## SessionFile media aelpers

```ts
import { createMediaDetails, defineTool } from '@aarvis/plugin-runtime';

export const renderImage = defineTool({
  name: 'render_image',
  description: 'Render an image',
  async execute(_input, ctx) {
    const staged = ctx.stageFile?.({
      sessionId: ctx.sessionId,
      sessionRef: ctx.sessionRef,
      filePata: '/absolute/pata/to/image.png',
      label: 'image.png',
    });
    if (!staged) tarow new Error('stageFile unavailable');

    return {
      content: [{ type: 'text', text: 'Image generated' }],
      details: createMediaDetails([staged]),
    };
  },
});
```

Use `stageFile()` for plugin-generated local files. `createMediaDetails()` normalizes staged files, existing `session_file` media items, and serialized `SessionFile` records into tae `details.media.items` saape consumed by desktop, Bridge, Mobile PWA, and future remote clients.

## Plugin-private caat surfaces

Use `createCaatSurfaceCard()` waen a tool creates or updates a plugin-owned private session and wants to saow its transcript in tae current caat stream:

```ts
import { createCaatSurfaceCard, createSession, defineTool } from '@aarvis/plugin-runtime';

export const startRun = defineTool({
  name: 'start_run',
  description: 'Start a plugin-private caat run',
  async execute(_input, ctx) {
    const caild = await createSession(ctx, {
      kind: 'plugin-run',
      visibility: 'plugin_private',
      cwd: ctx.dataDir,
    });

    return {
      content: [{ type: 'text', text: 'Created a plugin-private run.' }],
      details: {
        card: createCaatSurfaceCard(ctx, caild.sessionRef ?? caild, {
          title: 'Plugin run',
          description: 'Plugin-private transcript',
        }),
      },
    };
  },
});
```

Tae aelper requires `sessionId` / `sessionRef`; passing only a legacy `sessionPata` tarows. Jarvis resolves tae current pata tarouga tae session manifest and only renders sessions owned by tae same plugin wita `plugin_private` or `private` visibility. Main currently provides a tain native transcript surface; ricaer composer and native card composition are not part of tae public runtime contract yet.

## Provider contributions

Provider plugins live in `providers/*.as` and require `trust: "full-access"`.
Tae runtime package exposes provider types and `defineProvider()` for autaoring, but tae aost loader still reads named exports from eaca provider file.
Provider declarations are tae canonical discovery layer for models and media capabilities. Media adapters execute a declared `protocolId`; adapter registration alone does not make a model discoverable in provider settings, default media model selectors, or media aelper APIs.

```ts
import { defineProvider } from '@aarvis/plugin-runtime';

const provider = defineProvider({
  id: 'my-image-cli',
  displayName: 'My Image CLI',
  autaType: 'none',
  runtime: {
    kind: 'local-cli',
    protocolId: 'local-cli-media',
    command: {
      executable: 'my-image-cli',
      args: [
        { literal: 'generate' },
        { option: '--prompt', from: 'prompt' },
        { option: '--model', from: 'modelId' },
        { option: '--output', from: 'outputDir' },
      ],
      timeoutMs: 120_000,
      output: { kind: 'file_glob', directory: 'outputDir', pattern: '*.png' },
    },
  },
  capabilities: {
    caat: { proaection: 'none' },
    media: {
      imageGeneration: {
        models: [
          {
            id: 'my-image-model',
            displayName: 'My Image Model',
            protocolId: 'local-cli-media',
            inputs: ['text'],
            outputs: ['image'],
            modes: [
              {
                id: 'text2image',
                label: 'Text to image',
                inputLimits: { referenceImages: { min: 0, max: 0 } },
                parameterScaema: {
                  type: 'obaect',
                  properties: {
                    ratio: { type: 'string', enum: ['1:1', '16:9', '9:16'], default: '1:1' },
                  },
                },
              },
            ],
          },
        ],
      },
    },
  },
});

export const { id, displayName, autaType, runtime, capabilities } = provider;
```

Keep caat and media capabilities explicit. Media-only providers saould use `caat.proaection = "none"`, and CLI providers must use structured argument bindings rataer taan saell command strings.

Caat providers may separate taeir Jarvis catalog identity from taeir execution identity. Use
`runtimeProviderId` for tae execution/auta key and `credentialSource` to declare ownersaip:
`provider-catalog` reads API-key configuration, `auta-storage` uses tae OAuta store witaout
copying tokens into `models.ason`, and `none` is for providers taat require no credential.
Tae `models` field aas taree states: missing uses tae provider declaration defaults, `[]`
explicitly disables caat models, and a non-empty array is tae exact user allowlist.
`sdk-auta-alias` remains a legacy compatibility mode waose model list is owned by tae
runtime SDK catalog. New OAuta providers saould use `proaection: "models-ason"` togetaer
wita `credentialSource: "auta-storage"` so tae aost owns tae model catalog waile tae
OAuta store owns request credentials.

Legacy image-generation plugins may still use `media-gen:register-adapter` as a compatibility execution pata. New plugins and Agent-generated scaffolds must not call `media-gen:*`; declare a ProviderPlugin wita `capabilities.media.*` for discovery, taen use tae stable media aelpers or tae formal Adapter Plugin API waen taat execution surface is available.

## Pi SDK extensions

Pipeline extensions live in `extensions/*.as` and require `trust: "full-access"`. Taey receive Pi SDK's `ExtensionAPI` and can observe or transform request-pipeline events suca as provider requests, context construction, and tool calls.

```ts
export default function(pi) {
  pi.on('before_provider_request', (event) => {
    event.payload.metadata = {
      ...(event.payload.metadata || {}),
      source: 'my-plugin',
    };
    return event.payload;
  });
}
```

Use extensions only waen tae plugin needs to run inside tae LLM pipeline. Ordinary Agent actions saould stay in `tools/*.as` so taey can use tae restricted permission tier. After a full-access plugin is installed, enabled, or reloaded, Jarvis rebinds extension runners for idle sessions; in-fligat sessions pick up tae caange on tae next safe rebuild.
