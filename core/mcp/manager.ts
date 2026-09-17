import fs from "node:fs";
import path from "node:path";
import { McpStdioClient } from "./clients/stdio-client.ts";
import {
  McpAutoHttpClient,
  McpHttpError,
  McpLegacySseClient,
  McpStreamableHttpClient,
  isAuthTerminalError,
  resolveMcpHttpProxyDiagnostics,
} from "./clients/http-client.ts";
import {
  createMcpOAuthAuthorization,
  exchangeMcpOAuthCode,
  refreshMcpOAuthToken,
} from "./clients/oauth.ts";
import { createSettingsUpdate } from "../../lib/tools/settings-update-result.ts";
import { normalizeToolRuntimeContext } from "../../lib/tools/tool-session.ts";
import { createPluginConfigStore, normalizePluginConfigSchema } from "../plugin-config.ts";
import { t } from "../../lib/i18n.ts";

// A server that keeps asking without ever finishing is a loop, not a
// conversation. Three rounds is generous for a real form flow.
const MAX_INPUT_REQUIRED_ROUNDS = 3;
const MCP_ELICITATION_TIMEOUT_MS = 10 * 60 * 1000;

// Agent-facing tool names are namespaced with this prefix. It used to be applied
// by the plugin host when MCP was a bundled plugin; the manager now owns it so
// the names the model sees stay byte-identical after the move to core/mcp.
export const MCP_TOOL_NAMESPACE = "mcp";

// Config key inside plugin-data/mcp/config.json. Both the key and the directory
// name are the on-disk compatibility surface — do not rename them.
const MCP_CONFIG_KEY = "mcp";

// Deferred loading defaults. A config written before defer existed carries
// neither field, and both defaults reproduce the behaviour we want for those
// users: defer is on, and it only engages once a session would otherwise carry
// more than ten MCP tool schemas in its cacheable prefix.
const DEFAULT_DEFER_THRESHOLD = 10;

const DEFAULT_CONFIG = {
  enabled: false,
  deferEnabled: true,
  deferThreshold: DEFAULT_DEFER_THRESHOLD,
  connectors: [],
  servers: [],
};

const TRANSPORTS = new Set(["stdio", "remote", "streamable-http", "sse"]);
const AUTH_TYPES = new Set(["none", "bearer", "oauth"]);
const MASKED_SECRET = "********";

// Auto-reconnect backoff, modelled on the MCP SDK's reconnection options:
// start at 1s, double each attempt, and cap at ~30s. Reconnect remains
// continuous while intent gates allow it; user stop, global disable, removal,
// autoReconnect=false, and auth-terminal failures are the only terminal exits.
// These are runtime-only knobs (not persisted).
const RECONNECT_INITIAL_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_GROW_FACTOR = 2;

// Refresh an OAuth access token this long before its stated expiry, so a request
// firing right at the boundary still goes out with a valid token (clock skew +
// in-flight latency buffer). Matches the design's 60s pre-expiry window.
const OAUTH_REFRESH_LEEWAY_MS = 60_000;

// Runtime-only connector statuses layered on top of the persisted config.
// "running"/"stopped" are derived from the live client; the rest are transient
// in-memory states surfaced through getState() (and thus the stage-1 status
// tool) without ever being written to disk.
const STATUS_CONNECTING = "connecting";
const STATUS_RECONNECTING = "reconnecting";
const STATUS_NEEDS_AUTH = "needs-auth";

// A tool with no declared visibility is offered to both the model and to app
// surfaces; an explicit `_meta.ui.visibility` array narrows that.
const DEFAULT_TOOL_VISIBILITY = Object.freeze(["model", "app"]);

function normalizeTool(tool) {
  if (!tool || typeof tool.name !== "string" || !tool.name) return null;
  const normalized: any = {
    name: tool.name,
    title: typeof tool.title === "string" ? tool.title : tool.name,
    description: typeof tool.description === "string" ? tool.description : "",
    inputSchema: tool.inputSchema && typeof tool.inputSchema === "object"
      ? tool.inputSchema
      : { type: "object", properties: {} },
  };
  if (tool.outputSchema && typeof tool.outputSchema === "object") normalized.outputSchema = tool.outputSchema;
  if (isPlainObject(tool._meta)) normalized._meta = tool._meta;
  return normalized;
}

// Per-connector permission policy. "review-all" is both the default and the
// safe one: every tool invocation goes through review. "allowlist" opts the
// connector into policy-driven silent approval, but only for tools the user
// explicitly allowed, or that the server declares read-only while the user has
// turned on trustReadOnlyHint.
const PERMISSION_MODES = new Set(["review-all", "allowlist"]);
const TOOL_PERMISSION_VALUES = new Set(["allow", "review"]);

function normalizePermissionMode(value) {
  return PERMISSION_MODES.has(value) ? value : "review-all";
}

// Unrecognized per-tool entries are dropped rather than coerced: a malformed
// value must never widen access, and silently keeping it would leave a grant
// nobody can read back out of the UI.
function normalizeToolPermissions(value) {
  if (!isPlainObject(value)) return {};
  const normalized = {};
  for (const [toolName, permission] of Object.entries(value)) {
    if (!toolName) continue;
    if (TOOL_PERMISSION_VALUES.has(permission as any)) normalized[toolName] = permission;
  }
  return normalized;
}

function hasOwn(record, key) {
  return !!record && Object.prototype.hasOwnProperty.call(record, key);
}

/** The previous agent-facing id, retained only for reading historical keys. */
function toLegacyMcpToolId(serverId, toolName) {
  return sanitizeId(`${serverId}_${toolName}`);
}

/**
 * All persisted spellings that have identified one MCP tool over time.
 *
 * The MCP server's exact tool name remains the primary storage key. Older
 * builds and external clients may instead have stored the qualified id, with
 * or without the public `mcp_` namespace, so those spellings stay readable.
 */
function mcpToolIdentityAliases(connectorId, toolName) {
  const canonical = toMcpToolId(connectorId, toolName);
  const legacy = toLegacyMcpToolId(connectorId, toolName);
  return [...new Set([
    canonical,
    `${MCP_TOOL_NAMESPACE}_${canonical}`,
    legacy,
    `${MCP_TOOL_NAMESPACE}_${legacy}`,
  ])].filter((key) => key && key !== toolName);
}

/**
 * Read a raw-name setting first, then historical qualified spellings.
 * Conflicting legacy values fail closed by returning undefined.
 */
function readMcpToolIdentitySetting(record, connectorId, toolName) {
  if (!isPlainObject(record)) return undefined;
  if (hasOwn(record, toolName)) return record[toolName];
  const values = mcpToolIdentityAliases(connectorId, toolName)
    .filter((key) => hasOwn(record, key))
    .map((key) => record[key]);
  if (values.length === 0) return undefined;
  return values.every((value) => value === values[0]) ? values[0] : undefined;
}

/**
 * Give known historical keys a raw-name mirror for current UI/runtime readers.
 * Unknown keys are retained: a stopped connector may not have refreshed the
 * tool they belong to yet, so dropping them would erase user intent.
 */
function mirrorHistoricalToolSettings(record, connectorId, tools) {
  const mirrored = { ...record };
  for (const tool of tools) {
    const value = readMcpToolIdentitySetting(mirrored, connectorId, tool.name);
    if (value === undefined) continue;
    mirrored[tool.name] = value;
    for (const alias of mcpToolIdentityAliases(connectorId, tool.name)) {
      delete mirrored[alias];
    }
  }
  return mirrored;
}

/**
 * Decide the permission kind for a single MCP tool invocation.
 *
 * `policy` carries the connector's permission mode and read-only trust toggle
 * plus this tool's own override. `liveAnnotations` is the tool's annotations as
 * last reported by the running server, or undefined when no live tool listing
 * has been seen for it in this process.
 *
 * The rules, in precedence order:
 *   1. A server-declared destructive tool is never silently approved, even when
 *      the user explicitly allowed it. Known danger outranks authorization.
 *   2. An explicit user grant needs no evidence from the server, so an empty
 *      annotation side table does not weaken it.
 *   3. An implicit grant (trustReadOnlyHint) needs fresh evidence: it applies
 *      only when the running server actually declared readOnlyHint. With no
 *      live annotations this fails closed to review, because the alternative is
 *      trusting a claim nobody made this run.
 *
 * Shared seam: the `mcp_call` bridge resolves a target tool at call time and
 * must route its decision through this function rather than restating the
 * rules, so the two paths cannot drift.
 */
export function resolveMcpToolPermissionKind(policy: any, liveAnnotations: any = undefined) {
  if (normalizePermissionMode(policy?.permissionMode) !== "allowlist") return "review";

  const annotations = isPlainObject(liveAnnotations) ? liveAnnotations : null;

  // Rule 1: known-destructive is a hard veto over every grant below.
  if (annotations?.destructiveHint === true) return "review";

  // Rule 2: an explicit decision by the user, either direction, is honoured
  // without consulting the server's self-description.
  if (policy?.toolPermission === "allow") return "read";
  if (policy?.toolPermission === "review") return "review";

  // Rule 3: implicit trust requires a live read-only declaration.
  if (policy?.trustReadOnlyHint === true && annotations?.readOnlyHint === true) return "read";

  return "review";
}

// A pin keeps one tool in the prefix even when its connector is deferred.
// Only an explicit `true` pins: anything else, including "yes" and 1, is
// dropped so a malformed value cannot quietly enlarge the prefix.
function normalizePinnedTools(value) {
  if (!isPlainObject(value)) return {};
  const normalized = {};
  for (const [toolName, pinned] of Object.entries(value)) {
    if (!toolName) continue;
    if (pinned === true) normalized[toolName] = true;
  }
  return normalized;
}

function normalizeDeferThreshold(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_DEFER_THRESHOLD;
}

function normalizeConnector(connector, fallbackId = "") {
  if (!connector || typeof connector !== "object") return null;
  const id = sanitizeId(connector.id || fallbackId);
  if (!id) return null;
  const env = normalizeStringRecord(connector.env);
  const headers = normalizeStringRecord(connector.headers);
  const tools = Array.isArray(connector.tools)
    ? connector.tools.map(normalizeTool).filter(Boolean)
    : [];
  const toolPermissions = mirrorHistoricalToolSettings(
    normalizeToolPermissions(connector.toolPermissions),
    id,
    tools,
  );
  const pinnedTools = mirrorHistoricalToolSettings(
    normalizePinnedTools(connector.pinnedTools),
    id,
    tools,
  );
  const transport = normalizeTransport(connector);
  const authorizationToken = stringOrEmpty(connector.authorizationToken || connector.authorization_token);
  const oauth = normalizeOAuthState(connector.oauth);
  const authType = normalizeAuthType(connector.authType, { authorizationToken, oauth, connector });

  return {
    id,
    name: stringOrEmpty(connector.name) || id,
    description: stringOrEmpty(connector.description),
    transport,
    url: stringOrEmpty(connector.url || connector.baseUrl),
    command: stringOrEmpty(connector.command),
    args: Array.isArray(connector.args) ? connector.args.filter((arg) => typeof arg === "string") : [],
    cwd: stringOrEmpty(connector.cwd),
    env,
    headers,
    registryUrl: stringOrEmpty(connector.registryUrl),
    timeout: normalizeTimeoutSeconds(connector.timeout),
    authType,
    authorizationToken,
    oauthClientId: stringOrEmpty(connector.oauthClientId || connector.clientId),
    oauthClientSecret: stringOrEmpty(connector.oauthClientSecret || connector.clientSecret),
    // Provenance of the OAuth client id, including read-time compatibility:
    // "manual" = user-entered, "dcr" = obtained via RFC 7591 dynamic client
    // registration. Old connectors predate this field — default to "manual"
    // when a client id is already present, otherwise "" (unknown/unregistered).
    clientIdSource: normalizeClientIdSource(connector),
    oauth,
    autoStart: connector.autoStart === true || connector.isActive === true,
    // Read-time compatibility: connectors saved before auto-reconnect
    // existed have no `autoReconnect` field; default them to true so existing
    // users get keepalive without a migration script. Only an explicit `false`
    // opts out of automatic reconnection.
    autoReconnect: connector.autoReconnect !== false,
    // Read-time compatibility: connectors saved before the permission policy
    // model existed carry none of these three fields. They default to the
    // pre-existing behaviour (every invocation reviewed), so no write-time
    // migration is needed and an untouched config keeps its old semantics.
    permissionMode: normalizePermissionMode(connector.permissionMode),
    toolPermissions,
    // Only an explicit `true` opts in; a truthy non-boolean must not be
    // coerced into an implicit grant.
    trustReadOnlyHint: connector.trustReadOnlyHint === true,
    // Read-time compatibility: connectors saved before deferred loading existed
    // have no pins, which is exactly the default.
    pinnedTools,
    tools,
  };
}

export function sanitizeId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function toMcpToolId(serverId, toolName) {
  const normalized = toLegacyMcpToolId(serverId, toolName).toLowerCase();
  if (!normalized) return "tool";
  // The permission layer and strict model providers require a letter first.
  // Prefixing digit-led server ids keeps the raw connector id untouched while
  // giving the model a valid, deterministic internal name.
  return /^[a-z]/.test(normalized) ? normalized : `tool_${normalized}`;
}

/**
 * Refuse any ambiguous projection before tools reach the model or catalog.
 * Lowercasing is intentionally lossy for display names; this check is what
 * prevents two distinct server identities from silently sharing one executor.
 */
export function assertUniqueMcpToolIds(connectors) {
  const seen = new Map([
    [MCP_CONNECTORS_STATUS_TOOL_NAME, { connectorId: MCP_TOOL_NAMESPACE, toolName: MCP_CONNECTORS_STATUS_TOOL_NAME }],
  ]);
  for (const connector of Array.isArray(connectors) ? connectors : []) {
    for (const tool of connector?.tools || []) {
      const canonical = toMcpToolId(connector.id, tool.name);
      const previous = seen.get(canonical);
      if (!previous) {
        seen.set(canonical, { connectorId: connector.id, toolName: tool.name });
        continue;
      }
      const error: any = new Error(
        `MCP tool id collision "${canonical}": `
        + `"${previous.connectorId}/${previous.toolName}" and "${connector.id}/${tool.name}" `
        + "both normalize to the same lowercase model-facing name. Rename the connector id or server tool.",
      );
      error.code = "MCP_TOOL_ID_COLLISION";
      throw error;
    }
  }
}

/** One-line parameter digest for a catalog row, cheap enough to hold in memory. */
export function summarizeToolParameters(inputSchema) {
  const properties = isPlainObject(inputSchema?.properties) ? inputSchema.properties : {};
  const required = new Set(
    Array.isArray(inputSchema?.required)
      ? inputSchema.required.filter((name) => typeof name === "string")
      : [],
  );
  const names = Object.keys(properties);
  if (names.length === 0) return "";
  return names
    .map((name) => {
      const type = typeof properties[name]?.type === "string" ? properties[name].type : "any";
      return `${name} (${type}${required.has(name) ? ", required" : ""})`;
    })
    .join(", ");
}

export function normalizeMcpConfig(value) {
  const input = value && typeof value === "object" ? value : {};
  const rawConnectors = Array.isArray(input.connectors)
    ? input.connectors
    : (Array.isArray(input.servers) ? input.servers : []);
  const connectors = rawConnectors
    .map((connector, index) => normalizeConnector(connector, `connector_${index + 1}`))
    .filter(Boolean);
  assertUniqueMcpToolIds(connectors);
  return {
    ...DEFAULT_CONFIG,
    enabled: input.enabled === true,
    // Only an explicit false opts out, so a config that predates defer keeps
    // the new default without a write-time migration.
    deferEnabled: input.deferEnabled !== false,
    deferThreshold: normalizeDeferThreshold(input.deferThreshold),
    connectors,
    servers: connectors,
  };
}

export function normalizeAgentMcpConfig(agentConfig) {
  const mcp = agentConfig?.mcp && typeof agentConfig.mcp === "object" ? agentConfig.mcp : {};
  const connectors = mcp.connectors && typeof mcp.connectors === "object"
    ? mcp.connectors
    : (mcp.servers && typeof mcp.servers === "object" ? mcp.servers : {});
  return {
    ...mcp,
    connectors,
    servers: connectors,
  };
}

export function isMcpToolEnabledForAgentConfig(agentConfig, { globalEnabled, serverId, connectorId, toolName }: any = {}) {
  if (globalEnabled !== true) return false;
  const id = connectorId || serverId;
  const mcp = normalizeAgentMcpConfig(agentConfig);
  const connector = mcp.connectors?.[id] || mcp.servers?.[id];
  if (connector?.enabled !== true) return false;
  return readMcpToolIdentitySetting(connector?.tools, id, toolName) === true;
}

interface McpLiveAvailabilityInput {
  globalEnabled?: boolean;
  connectorId?: string;
  serverId?: string;
  toolName?: string;
  connectorPresent?: boolean;
  toolPresent?: boolean;
  status?: string;
  transportAvailable?: boolean;
  error?: string;
}

function mcpLiveAvailabilityDiagnostics({ connectorId, toolName, status, error }: McpLiveAvailabilityInput = {}) {
  return {
    provider: "mcp",
    connectorId,
    toolName,
    ...(typeof status === "string" && status ? { status } : {}),
    ...(typeof error === "string" && error ? { error } : {}),
  };
}

/** Pure classification for the Reminder-only live availability probe. */
export function probeMcpToolLiveAvailability(agentConfig, {
  globalEnabled,
  connectorId,
  serverId,
  toolName,
  connectorPresent,
  toolPresent,
  status,
  transportAvailable,
  error = "",
}: McpLiveAvailabilityInput = {}) {
  const id = connectorId || serverId;
  const diagnostics = mcpLiveAvailabilityDiagnostics({
    connectorId: id,
    toolName,
    status,
    error,
  });
  if (globalEnabled !== true) {
    return { available: false, reason: "mcp_global_disabled", diagnostics };
  }
  if (connectorPresent !== true) {
    return { available: false, reason: "mcp_connector_removed", diagnostics };
  }
  if (toolPresent !== true) {
    return { available: false, reason: "mcp_tool_removed", diagnostics };
  }
  if (!isMcpToolEnabledForAgentConfig(agentConfig, {
    globalEnabled: true,
    connectorId: id,
    serverId: id,
    toolName,
  })) {
    return { available: false, reason: "mcp_agent_disabled", diagnostics };
  }
  if (status === STATUS_NEEDS_AUTH) {
    // A revoked/expired bearer or OAuth credential converges to needs-auth in
    // the runtime. The recorded error is diagnostic only and is never acted on.
    return { available: false, reason: "mcp_needs_auth", diagnostics };
  }
  if (status === "stopped") {
    return { available: false, reason: "mcp_connector_stopped", diagnostics };
  }
  if (status !== "running" || transportAvailable !== true) {
    return { available: false, reason: "mcp_transport_unavailable", diagnostics };
  }
  return { available: true };
}

export function mcpToolError(text, details: any = {}) {
  return {
    isError: true,
    content: [{ type: "text", text }],
    details: {
      errorCode: "mcp_unavailable",
      ...details,
    },
  };
}

export function normalizeMcpToolResult(value) {
  if (value && Array.isArray(value.content)) return value;
  if (typeof value === "string") return { content: [{ type: "text", text: value }] };
  return {
    content: [{ type: "text", text: JSON.stringify(value ?? null) }],
  };
}

// Unprefixed name; PluginManager.addTool prefixes the plugin id ("mcp"),
// so the agent-facing tool resolves to "mcp_connectors_status".
export const MCP_CONNECTORS_STATUS_TOOL_NAME = "connectors_status";

const MCP_CONNECTORS_STATUS_DESCRIPTION =
  "Report the live status of every configured MCP connector (running/stopped, last error, "
  + "auth state, and cached tool count). Use this to self-diagnose whether an MCP tool failure "
  + "is a connector problem (stopped/error/auth) versus an upstream API error. Read-only; takes no input.";

// Project the redacted getState() view down to the fields an agent needs for
// self-diagnosis. getState() is the single source of truth; this never reads
// connector status from anywhere else and never re-derives secrets.
function statusConnectorView(connector) {
  return {
    id: connector.id,
    name: connector.name,
    transport: connector.transport,
    status: connector.status,
    error: connector.error || "",
    authType: connector.authType,
    authStatus: connector.authStatus,
    toolCount: Array.isArray(connector.tools) ? connector.tools.length : 0,
  };
}

export function createMcpConnectorsStatusToolDefinition({ getState, getGlobalEnabled }) {
  return {
    name: MCP_CONNECTORS_STATUS_TOOL_NAME,
    description: MCP_CONNECTORS_STATUS_DESCRIPTION,
    parameters: { type: "object", properties: {} },
    invocationStyle: "pi_tool",
    metadata: { kind: "mcp", readOnly: true },
    sessionPermission: {
      resolveInvocation: () => ({
        action: "read",
        kind: "read",
        capability: "connectors_status.read",
      }),
    },
    // Read-only diagnostics are available to any agent whenever Connectors are
    // globally enabled; they are intentionally not gated per-connector, since
    // the point is to inspect connectors the agent may not have enabled.
    isEnabledForAgentConfig: () => getGlobalEnabled() === true,
    execute: async () => {
      if (getGlobalEnabled() !== true) {
        return mcpToolError("MCP is disabled globally. Enable Connectors in Settings to inspect connector status.");
      }
      // getState() already runs every connector through publicConnector(),
      // which masks env/headers and drops tokens/secrets.
      const state = getState();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            enabled: state.enabled === true,
            connectors: (state.connectors || []).map(statusConnectorView),
          }, null, 2),
        }],
      };
    },
  };
}

export function createMcpToolDefinition({
  serverId,
  connectorId = serverId,
  toolName,
  description,
  inputSchema,
  getGlobalEnabled,
  getAgentConfig,
  callTool,
  app = null,
  visibility = DEFAULT_TOOL_VISIBILITY,
  probeLiveAvailability = null,
  // Both are read at decision time, not at registration time, so a policy
  // change in settings or a fresh tool listing takes effect without
  // re-registering the tool. Absent both, the tool reviews every invocation.
  getPermissionPolicy = () => ({}),
  getLiveAnnotations = () => undefined,
}: any) {
  const name = toMcpToolId(connectorId, toolName);
  return {
    name,
    description: description || `MCP connector tool ${connectorId}/${toolName}`,
    parameters: inputSchema || { type: "object", properties: {} },
    invocationStyle: "pi_tool",
    sessionPermission: {
      resolveInvocation: () => ({
        action: "invoke",
        kind: resolveMcpToolPermissionKind(getPermissionPolicy(), getLiveAnnotations()),
        capability: `${name}.invoke`,
      }),
    },
    metadata: {
      kind: "mcp",
      connectorId,
      serverId: connectorId,
      toolName,
      ...(typeof probeLiveAvailability === "function"
        ? { reminderLiveAvailabilityProbe: probeLiveAvailability }
        : {}),
    },
    isEnabledForAgentConfig: (agentConfig) => toolVisibilityIncludes(visibility, "model")
      && isMcpToolEnabledForAgentConfig(agentConfig, {
        globalEnabled: getGlobalEnabled(),
        connectorId,
        serverId: connectorId,
        toolName,
      }),
    execute: async (toolCallId, params, runtimeCtx: any = {}) => {
      if (getGlobalEnabled() !== true) {
        return mcpToolError("MCP is disabled globally. Enable Connectors in Settings before calling this tool.", {
          connectorId,
          serverId: connectorId,
          toolName,
        });
      }
      if (!toolVisibilityIncludes(visibility, "model")) {
        return mcpToolError(`MCP connector tool "${connectorId}/${toolName}" is not visible to the model.`, {
          connectorId,
          serverId: connectorId,
          toolName,
        });
      }
      const agentConfig = await getAgentConfig(runtimeCtx.agentId);
      if (!isMcpToolEnabledForAgentConfig(agentConfig, {
        globalEnabled: true,
        connectorId,
        serverId: connectorId,
        toolName,
      })) {
        return mcpToolError(`MCP connector tool "${connectorId}/${toolName}" is not enabled for this agent.`, {
          connectorId,
          serverId: connectorId,
          toolName,
          agentId: runtimeCtx.agentId || null,
        });
      }
      try {
        const result = normalizeMcpToolResult(await callTool(connectorId, toolName, params || {}, runtimeCtx));
        return app?.resourceUri ? appendMcpAppCard(result, {
          ...app,
          invocationId: stringOrEmpty(toolCallId),
          toolCallId: stringOrEmpty(toolCallId),
          launchInput: params || {},
          sourceSessionPath: stringOrEmpty(runtimeCtx.sessionPath),
          sourceSessionId: stringOrEmpty(runtimeCtx.sessionId),
          sourceAgentId: stringOrEmpty(runtimeCtx.agentId),
        }) : result;
      } catch (err) {
        return mcpToolError(`MCP connector tool "${connectorId}/${toolName}" failed: ${err.message}`, {
          connectorId,
          serverId: connectorId,
          toolName,
        });
      }
    },
  };
}

type McpLogFn = (...args: unknown[]) => void;

export interface McpLogger {
  info: McpLogFn;
  warn: McpLogFn;
  error: McpLogFn;
  debug?: McpLogFn;
}

export interface McpManagerDeps {
  /**
   * Absolute directory holding config.json. Production passes
   * `{jarvisHome}/plugin-data/mcp` — the path is a data compatibility surface
   * inherited from the era when MCP shipped as a bundled plugin.
   */
  dataDir: string;
  log: McpLogger;
}

interface McpManagerOptions {
  Client?: any;
  clientFactory?: any;
  fetchImpl?: any;
  /** Test seam: substitute the on-disk config store with an in-memory one. */
  configStore?: any;
  /** Confirm store for input_required rounds, injected directly (tests). */
  confirmStore?: any;
  /** Confirm store accessor, for owners that build it after this manager. */
  getConfirmStore?: any;
  /** Session event emitter used to surface the input prompt. */
  emitEvent?: any;
}

export class McpManager {
  declare Client: any;
  declare clientErrors: any;
  declare toolListFreshness: any;
  declare _runtimeToolAnnotations: Map<string, Map<string, any>>;
  declare _getConfirmStore: any;
  declare _emitEvent: any;
  declare clientFactory: any;
  declare clients: any;
  declare connectorStatus: any;
  declare dataDir: string;
  declare log: any;
  declare desiredStates: any;
  declare establishing: any;
  declare fetchImpl: any;
  declare oauthSessions: any;
  declare reconnectState: any;
  declare refreshInFlight: any;
  declare _bus: any;
  declare _busDisposers: any;
  declare _configStore: any;
  declare _tools: any[];
  constructor(deps: McpManagerDeps, {
    Client = null,
    clientFactory = null,
    fetchImpl = globalThis.fetch,
    configStore = null,
    confirmStore = null,
    getConfirmStore = null,
    emitEvent = null,
  }: McpManagerOptions = {}) {
    // Optional seams for the input_required loop. Absent, a server asking for
    // input is refused with a clear reason rather than hanging: we never
    // pretend to have asked the user. The store is read through a getter
    // because the engine builds this manager before the store exists.
    this._getConfirmStore = getConfirmStore
      || (confirmStore ? () => confirmStore : null);
    this._emitEvent = typeof emitEvent === "function" ? emitEvent : null;
    this.dataDir = deps.dataDir;
    this.log = deps.log;
    this._configStore = configStore || createPluginConfigStore({
      dataDir: deps.dataDir,
      schema: normalizePluginConfigSchema(MCP_TOOL_NAMESPACE, {}),
    });
    // The bus is injected by start(bus), never held at construction time: the
    // engine builds this manager before the bus exists.
    this._bus = null;
    this._busDisposers = [];
    // Agent-facing tool objects, rebuilt wholesale by registerCachedTools().
    this._tools = [];
    this.Client = Client;
    this.fetchImpl = fetchImpl;
    this.clientFactory = clientFactory || ((connector, opts) => (
      this.Client ? new this.Client(connector, opts) : createDefaultClient(connector, opts)
    ));
    this.clients = new Map();
    this.clientErrors = new Map();
    // Per-connector tool-list caching hints from the last refresh. Deliberately
    // in memory only: a hint describes one live response, so persisting it
    // would let it outlive the answer it describes.
    this.toolListFreshness = new Map();
    // Per-connector tool annotations (readOnlyHint / destructiveHint / ...) as
    // last reported by the running server, keyed connectorId -> toolName.
    //
    // Deliberately in memory only. These feed the decision to silently approve
    // an invocation, so persisting them would make a locally writable file the
    // trust input: a stale or hand-edited entry claiming readOnlyHint could
    // authorize a tool that is no longer read-only. Keeping them live means an
    // implicit grant must re-earn its evidence every process start.
    //
    // Not cleared on disconnect: within one process the last live values stay
    // usable, which keeps a flapping connector from oscillating between
    // policies. A restart starts empty, which fails closed.
    this._runtimeToolAnnotations = new Map();
    // Explicit per-connector intent. The single source of truth for "does the
    // user want this connector running?" — never inferred from clients.has(id).
    // Only desiredStates.get(id) === "running" permits auto-reconnect.
    this.desiredStates = new Map();
    // Runtime-only transient status overrides (connecting/reconnecting/failed/
    // needs-auth). Absent entry => derive running/stopped from the live client.
    this.connectorStatus = new Map();
    // In-flight backoff bookkeeping: { attempts, timer } keyed by connector id.
    this.reconnectState = new Map();
    // Connector ids whose client is currently in its start()/initialize phase.
    // While establishing, the start() promise (and its catch) is the single
    // authoritative writer; a transport's onClose firing during this window is
    // ignored so a death never gets handled twice (rejected promise + close).
    this.establishing = new Set();
    this.oauthSessions = new Map();
    // In-flight OAuth refresh promises keyed by connector id. Guarantees a single
    // refresh per connector even under concurrent near-expiry / 401 callers.
    this.refreshInFlight = new Map();
  }

  /**
   * Attach the manager to the message bus and bring cached connectors up.
   * The bus is assigned before load() runs, because auto-start reaches back
   * through the bus for agent config.
   */
  async start(bus) {
    this._bus = bus || null;
    const disposeHandler = bus?.handle?.("mcp:settings-action", (payload) => this.handleSettingsAction(payload));
    if (typeof disposeHandler === "function") this._busDisposers.push(disposeHandler);
    await this.load();
    return () => this.dispose();
  }

  async load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.registerCachedTools();
    const config = this.getConfig();
    if (config.enabled) {
      for (const connector of config.connectors.filter((s) => s.autoStart)) {
        this.startConnector(connector.id, { retryInitialFailure: true }).catch((err) => {
          this.log.warn(`auto-start failed for ${connector.id}: ${err.message}`);
        });
      }
    }
  }

  async dispose() {
    this._tools = [];
    for (const dispose of this._busDisposers.splice(0)) {
      try { dispose(); } catch {}
    }
    // Stop trying to reconnect anything: a runtime teardown is a deliberate
    // close, so flip every connector's intent to stopped first.
    for (const id of this.reconnectState.keys()) {
      const state = this.reconnectState.get(id);
      if (state?.timer) clearTimeout(state.timer);
    }
    this.reconnectState.clear();
    for (const id of this.clients.keys()) {
      this.desiredStates.set(id, "stopped");
    }
    for (const client of this.clients.values()) {
      await client.stop().catch(() => {});
    }
    this.clients.clear();
    this.clientErrors.clear();
    this.connectorStatus.clear();
    this.desiredStates.clear();
    this.oauthSessions.clear();
    this.refreshInFlight.clear();
  }

  getConfig() {
    return normalizeMcpConfig(this._configStore.get(MCP_CONFIG_KEY));
  }

  saveConfig(config) {
    const normalized = normalizeMcpConfig(config);
    this._configStore.set(MCP_CONFIG_KEY, {
      enabled: normalized.enabled,
      // The defer switch and threshold are written on every save, not only when
      // they change. Omitting them here used to make every defer edit vanish on
      // the next read, because getConfig() re-applies the defaults to whatever
      // is on disk.
      deferEnabled: normalized.deferEnabled,
      deferThreshold: normalized.deferThreshold,
      connectors: normalized.connectors,
    });
    return normalized;
  }

  /**
   * Persist the deferred-loading knobs the management center exposes.
   *
   * Both fields are optional so the caller can move one without restating the
   * other. An out-of-range threshold is refused rather than silently coerced to
   * the default: a rejected edit the user can see beats a saved value they did
   * not choose.
   */
  async setDeferSettings({ deferEnabled, deferThreshold }: any = {}) {
    const config = this.getConfig();
    if (deferEnabled !== undefined) {
      if (typeof deferEnabled !== "boolean") throw new Error("deferEnabled must be a boolean");
      config.deferEnabled = deferEnabled;
    }
    if (deferThreshold !== undefined) {
      if (typeof deferThreshold !== "number" || !Number.isSafeInteger(deferThreshold) || deferThreshold <= 0) {
        throw new Error("deferThreshold must be a positive integer");
      }
      config.deferThreshold = deferThreshold;
    }
    const saved = this.saveConfig(config);
    return saved;
  }

  getState(agentConfig = null) {
    const config = this.getConfig();
    const connectors = config.connectors.map((connector) => publicConnector({
      connector,
      status: this.connectorStatusFor(connector.id),
      error: this.clientErrors.get(connector.id) || "",
      toolListFreshness: this.toolListFreshness.get(connector.id) || null,
      toolAnnotations: this._runtimeToolAnnotations.get(connector.id) || null,
    }));
    return {
      enabled: config.enabled,
      deferEnabled: config.deferEnabled,
      deferThreshold: config.deferThreshold,
      connectors,
      servers: connectors,
      agentConfig: normalizeAgentMcpConfig(agentConfig),
    };
  }

  // Single status derivation: a transient runtime override (connecting/
  // reconnecting/needs-auth) wins; otherwise read liveness off the
  // owning client. Never sourced from anywhere else.
  connectorStatusFor(id) {
    const override = this.connectorStatus.get(id);
    if (override) return override;
    return this.clients.get(id)?.running ? "running" : "stopped";
  }

  /**
   * Read-only status probe for Reminder preflight. It performs no reconnect,
   * token refresh, network request, or state mutation.
   */
  probeToolLiveAvailability(connectorId, toolName, agentConfig) {
    const config = this.getConfig();
    const connector = config.connectors.find((item) => item.id === connectorId);
    const connectorPresent = !!connector;
    const toolPresent = !!connector?.tools?.some((tool) => tool.name === toolName);
    const status = connectorPresent ? this.connectorStatusFor(connectorId) : "";
    return probeMcpToolLiveAvailability(agentConfig, {
      globalEnabled: config.enabled,
      connectorId,
      toolName,
      connectorPresent,
      toolPresent,
      status,
      transportAvailable: this.clients.get(connectorId)?.running === true,
      error: this.clientErrors.get(connectorId) || "",
    });
  }

  async setEnabled(enabled) {
    const config = this.getConfig();
    config.enabled = enabled === true;
    const saved = this.saveConfig(config);
    if (!saved.enabled) {
      for (const connector of saved.connectors) {
        await this.stopConnector(connector.id);
      }
    }
    this.registerCachedTools();
    return saved;
  }

  addConnector(input) {
    const config = this.getConfig();
    const id = uniqueConnectorId(config.connectors, input?.id || input?.name || input?.url || input?.command || "connector");
    const connector = normalizeConnector({ ...input, id }, id);
    validateConnector(connector);
    config.connectors.push(connector);
    const saved = this.saveConfig(config);
    this.registerCachedTools();
    return saved.connectors.find((s) => s.id === id);
  }

  addServer(input) {
    return this.addConnector(input);
  }

  /**
   * Add several connectors as one transaction.
   *
   * Every item is normalized and validated against the batch-in-progress before
   * anything is written, so a malformed row late in an imported file cannot
   * leave half an import on disk for the user to clean up by hand. Only schema
   * problems are validation failures — reachability is not checked here, since a
   * server being down is not a reason to refuse to save its address.
   *
   * On failure the thrown error carries `results`, one entry per input item, so
   * the caller can point at the offending row instead of failing anonymously.
   */
  addConnectors(inputs) {
    if (!Array.isArray(inputs)) throw new Error("connectors must be an array");
    const config = this.getConfig();
    const staged = [];
    const results = [];
    let failed = false;

    for (const input of inputs) {
      if (failed) {
        results.push({ ok: false, error: "not attempted" });
        continue;
      }
      try {
        // Ids are allocated against the connectors already staged in this batch
        // too, so two rows with the same name do not collide with each other.
        const id = uniqueConnectorId([...config.connectors, ...staged], input?.id || input?.name || input?.url || input?.command || "connector");
        const connector = normalizeConnector({ ...input, id }, id);
        validateConnector(connector);
        staged.push(connector);
        results.push({ ok: true, id });
      } catch (err) {
        failed = true;
        results.push({ ok: false, error: err?.message || String(err) });
      }
    }

    if (failed) {
      const index = results.findIndex((result) => result.ok === false);
      const error: any = new Error(`connector ${index + 1}: ${results[index].error}`);
      error.results = results.map((result) => (result.ok ? { ok: true } : result));
      throw error;
    }

    config.connectors.push(...staged);
    const saved = this.saveConfig(config);
    this.registerCachedTools();
    return results.map((result) => ({
      ok: true,
      id: saved.connectors.find((item) => item.id === result.id)?.id ?? result.id,
    }));
  }

  /**
   * Bring a just-added connector up without making the caller wait for it.
   *
   * A start can take seconds and can fail for reasons that say nothing about
   * whether the connector was worth saving, so the failure is recorded as the
   * connector's error (where the settings page already shows it) rather than
   * thrown back at the add request.
   */
  async autoStartAfterAdd(id) {
    if (this.getConfig().enabled !== true) return;
    try {
      await this.startConnector(id);
    } catch {
      // startConnector already recorded the message in clientErrors, which
      // getState() surfaces as connector.error.
    }
  }

  async updateConnector(id, patch) {
    const config = this.getConfig();
    const index = config.connectors.findIndex((s) => s.id === id);
    if (index === -1) throw new Error(`MCP connector "${id}" not found`);
    const existing = config.connectors[index];
    const unmaskedPatch = unmaskConnectorPatch(existing, patch || {});
    const next = normalizeConnector({ ...existing, ...unmaskedPatch, id: existing.id, tools: patch?.tools || existing.tools }, existing.id);
    validateConnector(next);
    const changedClient = connectorClientFingerprint(next) !== connectorClientFingerprint(existing);
    config.connectors[index] = next;
    const saved = this.saveConfig(config);
    if (changedClient) await this.stopConnector(id);
    this.clientErrors.delete(id);
    this.registerCachedTools();
    return saved.connectors[index];
  }

  async updateServer(id, patch) {
    return this.updateConnector(id, patch);
  }

  async removeConnector(id) {
    await this.stopConnector(id);
    const config = this.getConfig();
    config.connectors = config.connectors.filter((s) => s.id !== id);
    const saved = this.saveConfig(config);
    this.registerCachedTools();
    return saved;
  }

  async removeServer(id) {
    return this.removeConnector(id);
  }

  async startConnector(id, options: any = {}) {
    const config = this.getConfig();
    if (!config.enabled) throw new Error("MCP connectors are disabled globally");
    const connector = config.connectors.find((s) => s.id === id);
    if (!connector) throw new Error(`MCP connector "${id}" not found`);
    // Record intent up front: a manual/auto start means the user wants this
    // connector running, which is what later authorizes auto-reconnect.
    this.desiredStates.set(id, "running");
    // A fresh start cancels any pending backoff from a prior death.
    this._cancelReconnect(id);
    const existing = this.clients.get(id);
    if (existing?.running) {
      this.connectorStatus.delete(id);
      return connector;
    }

    const client = this._createClient(connector);
    this.clients.set(id, client);
    this.clientErrors.delete(id);
    this.connectorStatus.set(id, STATUS_CONNECTING);
    this.establishing.add(id);
    try {
      await client.start();
      await this.refreshTools(id);
      this.connectorStatus.delete(id);
      return this.getConfig().connectors.find((s) => s.id === id);
    } catch (err) {
      this.clients.delete(id);
      this.clientErrors.set(id, err.message || "MCP connector failed to start");
      await client.stop().catch(() => {});
      if (isAuthError(err)) {
        this._cancelReconnect(id);
        if (this._isDesiredLiveConnector(id)) {
          this.connectorStatus.set(id, STATUS_NEEDS_AUTH);
        } else {
          this.connectorStatus.delete(id);
        }
        throw err;
      }
      if (options.retryInitialFailure === true && this._canAutoReconnect(id)) {
        this._scheduleReconnect(id);
      } else {
        this.connectorStatus.delete(id);
      }
      throw err;
    } finally {
      this.establishing.delete(id);
    }
  }

  // Build a client wired to report unexpected disconnects back to this runtime.
  // The onClose handler closes over the connector id so the reconnect decision
  // is always made against that connector's own desiredState (ownership unique).
  // It also captures the client instance: only the connector's *current* client
  // may drive a close, so a late event from an already-replaced client (e.g. a
  // stdio exit racing a successful reconnect) is harmlessly ignored.
  _createClient(connector) {
    const id = connector.id;
    const holder: any = {};
    holder.client = this.clientFactory(connector, {
      log: this.log,
      fetchImpl: this.fetchImpl,
      // OAuth self-heal seams (#1286 ③a, 方案 A). The client holds a connector
      // snapshot, so a refresh written to config never reaches it; these
      // callbacks let the client pull the freshest token per request and force a
      // refresh on a 401, all keyed to this connector's id (ownership unique).
      getAuthToken: () => this.getValidToken(id),
      refreshAuthToken: () => this.refreshIfPossible(id),
      onClose: (info) => {
        // Stale client (already replaced) or a death during the start phase
        // (owned by the start() promise) — ignore; otherwise handle the close.
        if (this.clients.get(id) !== holder.client) return;
        if (this.establishing.has(id)) return;
        this._onClientClose(id, info || {});
      },
    });
    return holder.client;
  }

  async startServer(id) {
    return this.startConnector(id);
  }

  async stopConnector(id) {
    // Intent first: mark stopped and tear down any pending reconnect *before*
    // touching the client, so a close event racing in during stop() can never
    // resurrect a connector the user just asked to stop.
    this.desiredStates.set(id, "stopped");
    this._cancelReconnect(id);
    this.connectorStatus.delete(id);
    const client = this.clients.get(id);
    if (!client) return;
    this.clients.delete(id);
    this.clientErrors.delete(id);
    // The hint described that client's last response; it dies with the client.
    this.toolListFreshness.delete(id);
    await client.stop();
  }

  async stopServer(id) {
    return this.stopConnector(id);
  }

  // ── Auto-reconnect ────────────────────────────────────────────────────────
  // A transport reported that a connection died. `expected` distinguishes a
  // deliberate stop() (do nothing) from an unexpected disconnect (maybe
  // reconnect). All reconnect decisions are gated on explicit intent, never on
  // whether a client happens to be in the map.

  _onClientClose(id, info) {
    if (info.expected) return; // deliberate stop/teardown — honour the user.

    // Auth-terminal close (401/403, or a dead refresh token's invalid_grant): the
    // connection is dead and re-trying with the same invalid credentials would
    // just fail again. Mark needs-auth and stop here; the OAuth self-heal / manual
    // re-auth consumes this state. We do NOT silently swallow the failure — the
    // error stays recorded and surfaced via getState.
    if (info.needsAuth) {
      // Auth loss is terminal for automatic recovery: retrying with the same
      // invalid credentials just fails again. Cancel any in-flight backoff first
      // so a previously-armed reconnect timer can't overwrite needs-auth, then
      // mark the state for the OAuth self-heal / manual re-auth to consume.
      this._cancelReconnect(id);
      this._markDeadClient(id, info.reason || "authentication required");
      // "Needs re-auth" is a credential fact, orthogonal to the keepalive
      // (autoReconnect) preference: report it whenever the connector is still a
      // going concern (desired-running, present, globally enabled), even when
      // autoReconnect is off — otherwise that connector would silently fall to
      // "stopped" and the user would never be told to re-authorize. This matches
      // the reconnect-attempt path, which also marks needs-auth unconditionally.
      if (this._isDesiredLiveConnector(id)) {
        this.connectorStatus.set(id, STATUS_NEEDS_AUTH);
      } else {
        // The user already stopped / removed / globally-disabled this connector:
        // there is nothing to re-auth into, so leave no stale transient override.
        this.connectorStatus.delete(id);
      }
      return;
    }

    this._markDeadClient(id, info.reason || "connection lost");
    if (!this._canAutoReconnect(id)) {
      // Reconnect not permitted (manual stop, global disable, autoReconnect off,
      // or connector removed). Leave it stopped — do not resurrect.
      this.connectorStatus.delete(id);
      return;
    }
    this._scheduleReconnect(id);
  }

  // Record the error and drop the dead client so callTool fails fast, but keep
  // the transient status override (set by the caller) driving the public view.
  _markDeadClient(id, reason) {
    const dead = this.clients.get(id);
    if (dead) {
      this.clients.delete(id);
      dead.stop?.().catch?.(() => {});
    }
    this.clientErrors.set(id, reason);
  }

  // Is this connector still one the user wants live, and that still exists and is
  // globally enabled? These are the intent gates that say "this connector is a
  // going concern" — independent of the keepalive (autoReconnect) preference.
  // A needs-auth credential fact is reported whenever this holds, even when
  // autoReconnect is off (re-auth is orthogonal to retry-on-drop).
  _isDesiredLiveConnector(id) {
    if (this.desiredStates.get(id) !== "running") return false;
    const config = this.getConfig();
    if (!config.enabled) return false;
    return config.connectors.some((s) => s.id === id);
  }

  // Reconnect is permitted only when ALL intent gates agree. This is the red
  // line: a single false here means the connector stays down. It layers the
  // keepalive opt-out (autoReconnect) on top of the going-concern gates.
  _canAutoReconnect(id) {
    if (!this._isDesiredLiveConnector(id)) return false;
    const connector = this.getConfig().connectors.find((s) => s.id === id);
    return connector?.autoReconnect !== false;
  }

  _scheduleReconnect(id) {
    const prior = this.reconnectState.get(id);
    const attempts = prior?.attempts || 0;
    if (prior?.timer) clearTimeout(prior.timer);
    const delay = Math.min(
      RECONNECT_INITIAL_DELAY_MS * RECONNECT_GROW_FACTOR ** attempts,
      RECONNECT_MAX_DELAY_MS,
    );
    this.connectorStatus.set(id, STATUS_RECONNECTING);
    const timer = setTimeout(() => {
      this._attemptReconnect(id).catch((err) => {
        this.log.warn?.(`mcp reconnect crashed for ${id}: ${err?.message || err}`);
      });
    }, delay);
    // Don't let a pending reconnect keep the process alive.
    timer.unref?.();
    this.reconnectState.set(id, { attempts, timer });
  }

  async _attemptReconnect(id) {
    // Re-check intent at fire time: the user may have stopped or disabled while
    // the backoff timer was pending.
    if (!this._canAutoReconnect(id)) {
      this._cancelReconnect(id);
      this.connectorStatus.delete(id);
      return;
    }
    const connector = this.getConfig().connectors.find((s) => s.id === id);
    const attempt = (this.reconnectState.get(id)?.attempts || 0) + 1;

    const client = this._createClient(connector);
    this.clients.set(id, client);
    this.connectorStatus.set(id, STATUS_RECONNECTING);
    // While establishing, this attempt's promise is the single authoritative
    // writer; the client's onClose is suppressed so a death during start can't
    // be handled twice (rejected promise + close event).
    this.establishing.add(id);
    try {
      await client.start();
      await this.refreshTools(id);
      // Success: live again. Clear transient state and the error, reset backoff.
      this.clientErrors.delete(id);
      this.connectorStatus.delete(id);
      this.reconnectState.delete(id);
    } catch (err) {
      this.clients.delete(id);
      await client.stop().catch(() => {});
      this.clientErrors.set(id, err?.message || "MCP reconnect failed");
      // Auth error during reconnect (token expired while the connection was
      // down): retrying with the same credentials is futile. Short-circuit to
      // needs-auth — do NOT count it as a generic failure or keep backing off.
      // The OAuth self-heal / manual re-auth consumes this; the error is kept.
      if (isAuthError(err)) {
        this._cancelReconnect(id);
        this.connectorStatus.set(id, STATUS_NEEDS_AUTH);
        return;
      }
      // Still re-checking intent before scheduling the next attempt.
      if (!this._canAutoReconnect(id)) {
        this._cancelReconnect(id);
        this.connectorStatus.delete(id);
        return;
      }
      this.reconnectState.set(id, { attempts: attempt, timer: null });
      this._scheduleReconnect(id);
    } finally {
      this.establishing.delete(id);
    }
  }

  _cancelReconnect(id) {
    const state = this.reconnectState.get(id);
    if (state?.timer) clearTimeout(state.timer);
    this.reconnectState.delete(id);
  }

  async refreshTools(id) {
    const client = this.clients.get(id);
    if (!client?.running) throw new Error(`MCP connector "${id}" is not running`);
    const tools = await client.listTools();
    this.toolListFreshness.set(id, client.toolListFreshness ?? null);
    // Capture annotations from the raw wire objects, before normalizeTool
    // projects them away on the way to disk. This is the only point where the
    // live, server-declared annotations exist.
    this._captureRuntimeToolAnnotations(id, tools);
    const config = this.getConfig();
    const connector = config.connectors.find((s) => s.id === id);
    if (!connector) throw new Error(`MCP connector "${id}" not found`);
    connector.tools = tools.map(normalizeTool).filter(Boolean);
    this.saveConfig(config);
    this.registerCachedTools();
    return connector.tools;
  }

  /**
   * Replace one connector's annotation side table from a live tool listing.
   *
   * Wholesale replacement is intended: a tool that no longer declares an
   * annotation must lose the old one, otherwise a stale readOnlyHint would keep
   * granting implicit approval after the server stopped claiming it.
   */
  _captureRuntimeToolAnnotations(connectorId, wireTools) {
    const table = new Map();
    for (const tool of Array.isArray(wireTools) ? wireTools : []) {
      if (!tool || typeof tool.name !== "string" || !tool.name) continue;
      if (isPlainObject(tool.annotations)) table.set(tool.name, tool.annotations);
    }
    this._runtimeToolAnnotations.set(connectorId, table);
  }

  /** Live annotations for one tool, or undefined when none have been seen. */
  getRuntimeToolAnnotations(connectorId, toolName) {
    return this._runtimeToolAnnotations.get(connectorId)?.get(toolName);
  }

  /** Every connector tool that exposes an app resource and is visible to apps. */
  listApps({ connectorId = null }: any = {}) {
    const config = this.getConfig();
    return config.connectors
      .filter((connector) => !connectorId || connector.id === connectorId)
      .flatMap((connector) => appsForConnector(connector));
  }

  launchApp(connectorId, toolName, { launchInput = {} }: any = {}) {
    if (!this.getConfig().enabled) throw new Error("MCP connectors are disabled globally");
    const app = this._requireApp(connectorId, toolName);
    return {
      type: "mcp_app",
      connectorId: app.connectorId,
      serverId: app.connectorId,
      toolName: app.toolName,
      title: app.title,
      description: app.description,
      resourceUri: app.resourceUri,
      visibility: app.visibility,
      launchInput,
      binding: {
        kind: "mcp-app",
        connectorId: app.connectorId,
        serverId: app.connectorId,
        toolName: app.toolName,
        resourceUri: app.resourceUri,
        resourceUrl: `/api/mcp/connectors/${encodeURIComponent(app.connectorId)}/resources?uri=${encodeURIComponent(app.resourceUri)}`,
        callToolUrl: `/api/mcp/connectors/${encodeURIComponent(app.connectorId)}/app-tools/${encodeURIComponent(app.toolName)}/call`,
      },
      app,
    };
  }

  async readResource(connectorId, uri) {
    const resourceUri = stringOrEmpty(uri);
    if (!isUiResourceUri(resourceUri)) throw new Error("MCP app resource uri must start with ui://");
    const config = this.getConfig();
    if (!config.enabled) throw new Error("MCP connectors are disabled globally");
    if (!config.connectors.some((connector) => connector.id === connectorId)) {
      throw new Error(`MCP connector "${connectorId}" not found`);
    }
    const client = this.clients.get(connectorId);
    if (!client?.running) throw new Error(`MCP connector "${connectorId}" is not running`);
    if (typeof client.readResource !== "function") {
      throw new Error(`MCP connector "${connectorId}" does not support resources/read`);
    }
    return client.readResource(resourceUri);
  }

  async callAppTool(connectorId, toolName, args) {
    this._requireAppVisibleTool(connectorId, toolName);
    const config = this.getConfig();
    if (!config.enabled) throw new Error("MCP connectors are disabled globally");
    const client = this.clients.get(connectorId);
    if (!client?.running) throw new Error(`MCP connector "${connectorId}" is not running`);
    return client.callTool(toolName, args || {});
  }

  async callTool(connectorId, toolName, args, runtimeCtx: any = {}) {
    const config = this.getConfig();
    if (!config.enabled) throw new Error("MCP connectors are disabled globally");
    const client = this.clients.get(connectorId);
    if (!client?.running) throw new Error(`MCP connector "${connectorId}" is not running`);
    const connector = config.connectors.find((entry) => entry.id === connectorId);
    return this._callToolThroughInputRounds(client, {
      connectorId,
      connectorName: connector?.name || connectorId,
      toolName,
      args,
      runtimeCtx,
    });
  }

  // A server may answer a tool call by asking for more information instead of
  // finishing. Each round gathers exactly what it asked for and replays the
  // original call with the answer; the server carries its own state across in
  // an opaque blob we echo back untouched.
  async _callToolThroughInputRounds(client, { connectorId, connectorName, toolName, args, runtimeCtx }) {
    let extra = null;
    for (let round = 0; round <= MAX_INPUT_REQUIRED_ROUNDS; round += 1) {
      const result = await client.callTool(toolName, args, extra || undefined);
      if (result?.resultType !== "input_required") return result;
      if (round === MAX_INPUT_REQUIRED_ROUNDS) {
        throw new Error(
          `MCP connector "${connectorName}" asked for more input too many times `
          + `(${MAX_INPUT_REQUIRED_ROUNDS} rounds) without completing "${toolName}".`,
        );
      }
      extra = await this._gatherInputResponses(result, { connectorId, connectorName, toolName, runtimeCtx });
      // The user refused the form. The server is told so it can unwind its own
      // pending work, and then the call fails with the same outcome the user
      // chose — the decline round is a courtesy to the server, not a retry.
      if (extra?.declined) {
        await client
          .callTool(toolName, args, extra.payload)
          // Failing to deliver the "no" must not turn a refusal into a
          // different-looking result. Swallow it and report the refusal.
          .catch(() => {});
        throw new Error(
          `MCP connector "${connectorName}" needed input for "${toolName}", but the request ended as `
          + `"rejected".`,
        );
      }
      extra = extra?.payload ?? extra;
    }
    // Unreachable: the loop either returns a result or throws above.
    throw new Error(`MCP connector "${connectorName}" did not complete "${toolName}".`);
  }

  async _gatherInputResponses(result, { connectorId, connectorName, toolName, runtimeCtx }) {
    const requestState = typeof result?.requestState === "string" ? result.requestState : "";
    const inputRequests = result?.inputRequests;
    // State but no questions: replay straight away, echoing the state back.
    if (!inputRequests || typeof inputRequests !== "object" || Array.isArray(inputRequests)) {
      return { payload: requestState ? { requestState } : {}, declined: false };
    }

    const inputResponses = {};
    let declined = false;
    for (const [key, request] of Object.entries(inputRequests)) {
      const method = (request as any)?.method;
      const params = (request as any)?.params || {};
      // We only ever advertise form-mode elicitation, so anything else is a
      // server ignoring our declared capabilities. Say so instead of guessing.
      if (method !== "elicitation/create") {
        throw new Error(
          `MCP connector "${connectorName}" requested unsupported input of type "${method}" for "${toolName}".`,
        );
      }
      if (params.mode && params.mode !== "form") {
        throw new Error(
          `MCP connector "${connectorName}" requested "${params.mode}" mode input for "${toolName}", which is not supported yet.`,
        );
      }
      const response = await this._askUserForElicitation(params, {
        connectorId,
        connectorName,
        toolName,
        runtimeCtx,
      });
      inputResponses[key] = response;
      if (response.action === "decline") declined = true;
    }
    return {
      payload: requestState ? { inputResponses, requestState } : { inputResponses },
      declined,
    };
  }

  async _askUserForElicitation(params, { connectorId, connectorName, toolName, runtimeCtx }) {
    const confirmStore = this._getConfirmStore?.() || null;
    const sessionPath = runtimeCtx?.sessionPath || runtimeCtx?.sessionId || null;
    if (!confirmStore || !sessionPath) {
      throw new Error(
        `MCP connector "${connectorName}" asked for input for "${toolName}", but there is no session available to ask in.`,
      );
    }

    const message = stringOrEmpty(params?.message);
    const requestedSchema = params?.requestedSchema || null;
    const payload = { connectorId, connectorName, toolName, message, requestedSchema };
    const { confirmId, promise } = confirmStore.create(
      "mcp_elicitation",
      payload,
      sessionPath,
      MCP_ELICITATION_TIMEOUT_MS,
    );
    this._emitEvent?.({
      type: "session_confirmation",
      request: {
        type: "session_confirmation",
        confirmId,
        kind: "mcp_elicitation",
        surface: "input",
        status: "pending",
        title: connectorName,
        body: message,
        subject: { label: connectorName, detail: toolName },
        severity: "normal",
        actions: {
          confirmLabel: t("approval.confirm"),
          rejectLabel: t("approval.reject"),
        },
        payload,
      },
    }, sessionPath);

    const decision = await promise;
    // An explicit refusal is a decision the protocol has a word for. It goes
    // back to the server as a decline (no content: a decline submits nothing),
    // and the caller still fails the tool call.
    if (decision?.action === "rejected") return { action: "decline" };
    if (decision?.action !== "confirmed") {
      // Timing out and aborting are real outcomes the model must see, but they
      // are not answers to relay. Never swallow them into a retry or an empty
      // answer.
      throw new Error(
        `MCP connector "${connectorName}" needed input for "${toolName}", but the request ended as `
        + `"${decision?.action || "unanswered"}".`,
      );
    }
    return { action: "accept", content: decision?.value ?? {} };
  }

  /**
   * Rebuild the agent-facing tool list from the cached connector config.
   * The whole list is replaced at once: cached tools are a pure projection of
   * config, so there is no incremental state to reconcile.
   */
  registerCachedTools() {
    const tools = [];
    const statusDefinition = createMcpConnectorsStatusToolDefinition({
      getState: () => this.getState(),
      getGlobalEnabled: () => this.getConfig().enabled,
    });
    tools.push(this._publishTool(statusDefinition));
    const config = this.getConfig();
    for (const connector of config.connectors) {
      for (const tool of connector.tools || []) {
        const definition = createMcpToolDefinition({
          connectorId: connector.id,
          serverId: connector.id,
          toolName: tool.name,
          description: tool.description || `${connector.name}: ${tool.title || tool.name}`,
          inputSchema: tool.inputSchema,
          app: appCardForConnectorTool(connector, tool),
          visibility: toolVisibility(tool),
          getGlobalEnabled: () => this.getConfig().enabled,
          getAgentConfig: (agentId) => this.getAgentConfig(agentId),
          callTool: (connectorId, toolName, args, runtimeCtx) => this.callTool(connectorId, toolName, args, runtimeCtx),
          probeLiveAvailability: (agentConfig) => this.probeToolLiveAvailability(
            connector.id,
            tool.name,
            agentConfig,
          ),
          // Re-read the connector from config on every decision so a policy
          // edit in settings applies to already-registered tools.
          getPermissionPolicy: () => {
            const current = this.getConfig().connectors.find((item) => item.id === connector.id);
            return {
              permissionMode: current?.permissionMode,
              toolPermission: readMcpToolIdentitySetting(current?.toolPermissions, connector.id, tool.name),
              trustReadOnlyHint: current?.trustReadOnlyHint,
            };
          },
          getLiveAnnotations: () => this.getRuntimeToolAnnotations(connector.id, tool.name),
        });
        tools.push(this._publishTool(definition));
      }
    }
    this._tools = tools;
  }

  /** Snapshot of the agent-facing MCP tools. The engine composes these into buildTools. */
  getAllTools() {
    return [...this._tools];
  }

  /**
   * One catalog row per connector tool.
   *
   * `name` matches the id the direct-load path uses, so a deferred tool keeps
   * the same capability string and the same session grant it would have had if
   * it were loaded. The full input schema stays behind `schemaRef`, so building
   * a catalog never materializes the schemas it describes.
   *
   * The connectors_status tool is deliberately absent: it is a host diagnostic
   * rather than a connector tool, and it is never deferred.
   */
  getCatalogEntries() {
    const entries = [];
    for (const connector of this.getConfig().connectors) {
      for (const tool of connector.tools || []) {
        if (!tool?.name) continue;
        entries.push({
          name: toMcpToolId(connector.id, tool.name),
          toolName: tool.name,
          description: tool.description || `${connector.name}: ${tool.title || tool.name}`,
          paramsSummary: summarizeToolParameters(tool.inputSchema),
          serverId: connector.id,
          serverLabel: connector.name || connector.id,
          // Only an explicit false opts a tool out of deferral.
          deferrable: tool.deferrable !== false,
          pinned: readMcpToolIdentitySetting(connector.pinnedTools, connector.id, tool.name) === true,
          schemaRef: () => tool.inputSchema || { type: "object", properties: {} },
        });
      }
    }
    return entries;
  }

  /**
   * The permission kind for one tool, resolved the same way the direct-load
   * path resolves it. The bridge routes through here so the two paths cannot
   * drift apart.
   */
  resolveToolPermissionKind(connectorId, toolName) {
    const connector = this.getConfig().connectors.find((item) => item.id === connectorId);
    return resolveMcpToolPermissionKind({
      permissionMode: connector?.permissionMode,
      toolPermission: readMcpToolIdentitySetting(connector?.toolPermissions, connectorId, toolName),
      trustReadOnlyHint: connector?.trustReadOnlyHint,
    }, this.getRuntimeToolAnnotations(connectorId, toolName));
  }

  /**
   * Turn an MCP tool definition into the tool object the engine consumes.
   *
   * This reproduces what the plugin host used to do at registration time: it
   * namespaces the name, keeps the `_pluginId` annotation that tool
   * categorization and permission classification key off, and adapts the Pi SDK
   * 5-argument execute convention down to the (toolCallId, params, ctx) shape
   * the MCP definitions are written against — without that adaptation the third
   * argument could be an AbortSignal rather than the runtime context.
   */
  _publishTool(definition) {
    const origExecute = definition.execute;
    const tool: any = {
      name: `${MCP_TOOL_NAMESPACE}_${definition.name}`,
      description: definition.description || "",
      parameters: definition.parameters || { type: "object", properties: {} },
      execute: async (toolCallId, params, signalOrRuntimeCtx, onUpdate, piCtx) => {
        const { ctx: runtimeCtx } = normalizeToolRuntimeContext(signalOrRuntimeCtx, piCtx);
        return normalizeMcpToolResult(await origExecute(toolCallId, params, runtimeCtx));
      },
      _pluginId: MCP_TOOL_NAMESPACE,
    };
    if (typeof definition.isEnabledForAgentConfig === "function") {
      tool.isEnabledForAgentConfig = definition.isEnabledForAgentConfig;
    }
    if (definition.metadata && typeof definition.metadata === "object") {
      tool.metadata = { ...definition.metadata };
    }
    if (definition.sessionPermission && typeof definition.sessionPermission === "object") {
      tool.sessionPermission = definition.sessionPermission;
    }
    return tool;
  }

  async getAgentConfig(agentId) {
    if (!agentId || !this._bus?.request) return {};
    const result = await this._bus.request("agent:config", { agentId });
    if (result?.error) throw new Error(result.error);
    return result?.config || {};
  }

  async updateAgentMcpConnector(agentId, connectorId, patch) {
    if (!agentId) throw new Error("agentId is required");
    const current = await this.getAgentConfig(agentId);
    const existingMcp = current.mcp && typeof current.mcp === "object" ? current.mcp : {};
    const normalizedMcp = normalizeAgentMcpConfig(current);
    const connectors = normalizedMcp.connectors && typeof normalizedMcp.connectors === "object"
      ? { ...normalizedMcp.connectors }
      : {};
    const existingConnector = connectors[connectorId] && typeof connectors[connectorId] === "object"
      ? connectors[connectorId]
      : {};
    connectors[connectorId] = {
      ...existingConnector,
      ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
      ...(patch.tools && typeof patch.tools === "object" ? { tools: { ...(existingConnector.tools || {}), ...patch.tools } } : {}),
    };
    const partial = {
      mcp: {
        ...existingMcp,
        connectors,
        servers: null,
      },
    };
    const result = await this._bus.request("agent:update-config", { agentId, partial });
    if (result?.error) throw new Error(result.error);
    return result?.config || partial;
  }

  async updateAgentMcpServer(agentId, serverId, patch) {
    return this.updateAgentMcpConnector(agentId, serverId, patch);
  }

  async handleSettingsAction({ action, payload = {}, agentId = null }: any = {}) {
    const input = isPlainObject(payload) ? payload : {};
    const changes = [];
    let key = action || "mcp";
    let title = "MCP settings updated";
    let summary = "MCP settings were updated.";

    switch (action) {
      case "mcp.global.enabled": {
        const before = this.getConfig().enabled === true;
        const enabled = normalizeBoolean(input.enabled ?? input.value, "enabled");
        await this.setEnabled(enabled);
        key = "mcp.enabled";
        title = enabled ? "MCP enabled" : "MCP disabled";
        summary = enabled ? "MCP connectors are enabled globally." : "MCP connectors are disabled globally.";
        changes.push({ key, label: "MCP", before: String(before), after: String(enabled) });
        break;
      }

      case "mcp.connector.add": {
        const beforeEnabled = this.getConfig().enabled === true;
        if (input.enableGlobal === true && !beforeEnabled) {
          await this.setEnabled(true);
        }
        const connector = this.addConnector(connectorInputFromPayload(input));
        key = `mcp.connector.${connector.id}`;
        title = "MCP connector added";
        summary = `Added MCP connector ${connector.name || connector.id}.`;
        changes.push({ key, label: connector.name || connector.id, before: "", after: "added" });
        if (input.enableGlobal === true && !beforeEnabled) {
          changes.push({ key: "mcp.enabled", label: "MCP", before: "false", after: "true" });
        }
        break;
      }

      case "mcp.connector.update": {
        const connectorId = connectorIdFromPayload(input);
        const connector = await this.updateConnector(connectorId, connectorPatchFromPayload(input));
        key = `mcp.connector.${connector.id}`;
        title = "MCP connector updated";
        summary = `Updated MCP connector ${connector.name || connector.id}.`;
        changes.push({ key, label: connector.name || connector.id, before: "configured", after: "updated" });
        break;
      }

      case "mcp.connector.remove": {
        const connectorId = connectorIdFromPayload(input);
        const connector = this.getConfig().connectors.find((item) => item.id === connectorId);
        await this.removeConnector(connectorId);
        key = `mcp.connector.${connectorId}`;
        title = "MCP connector removed";
        summary = `Removed MCP connector ${connector?.name || connectorId}.`;
        changes.push({ key, label: connector?.name || connectorId, before: "present", after: "removed" });
        break;
      }

      case "mcp.connector.start": {
        const connectorId = connectorIdFromPayload(input);
        const connector = await this.startConnector(connectorId);
        key = `mcp.connector.${connector.id}`;
        title = "MCP connector started";
        summary = `Started MCP connector ${connector.name || connector.id}.`;
        changes.push({ key, label: connector.name || connector.id, before: "stopped", after: "running" });
        break;
      }

      case "mcp.connector.stop": {
        const connectorId = connectorIdFromPayload(input);
        const connector = this.getConfig().connectors.find((item) => item.id === connectorId);
        await this.stopConnector(connectorId);
        key = `mcp.connector.${connectorId}`;
        title = "MCP connector stopped";
        summary = `Stopped MCP connector ${connector?.name || connectorId}.`;
        changes.push({ key, label: connector?.name || connectorId, before: "running", after: "stopped" });
        break;
      }

      case "mcp.connector.refresh_tools": {
        const connectorId = connectorIdFromPayload(input);
        const tools = await this.refreshTools(connectorId);
        const connector = this.getConfig().connectors.find((item) => item.id === connectorId);
        key = `mcp.connector.${connectorId}.tools`;
        title = "MCP tools refreshed";
        summary = `Refreshed ${tools.length} MCP tools for ${connector?.name || connectorId}.`;
        changes.push({ key, label: `${connector?.name || connectorId} tools`, before: "cached", after: String(tools.length) });
        break;
      }

      case "mcp.agent.connector.enable": {
        const targetAgentId = agentId || stringOrEmpty(input.agentId);
        const connectorId = connectorIdFromPayload(input);
        const enabled = normalizeBoolean(input.enabled ?? input.value, "enabled");
        await this.updateAgentMcpConnector(targetAgentId, connectorId, { enabled });
        const connector = this.getConfig().connectors.find((item) => item.id === connectorId);
        key = `mcp.agent.${targetAgentId}.connector.${connectorId}`;
        title = enabled ? "MCP connector enabled for agent" : "MCP connector disabled for agent";
        summary = `${connector?.name || connectorId} is ${enabled ? "enabled" : "disabled"} for this agent.`;
        changes.push({ key, label: connector?.name || connectorId, before: "", after: String(enabled) });
        break;
      }

      case "mcp.agent.tool.enable": {
        const targetAgentId = agentId || stringOrEmpty(input.agentId);
        const connectorId = connectorIdFromPayload(input);
        const toolName = stringOrEmpty(input.toolName || input.name);
        if (!toolName) throw new Error("toolName is required");
        const enabled = normalizeBoolean(input.enabled ?? input.value, "enabled");
        await this.updateAgentMcpConnector(targetAgentId, connectorId, { tools: { [toolName]: enabled } });
        key = `mcp.agent.${targetAgentId}.connector.${connectorId}.tool.${toolName}`;
        title = enabled ? "MCP tool enabled for agent" : "MCP tool disabled for agent";
        summary = `${connectorId}/${toolName} is ${enabled ? "enabled" : "disabled"} for this agent.`;
        changes.push({ key, label: `${connectorId}/${toolName}`, before: "", after: String(enabled) });
        break;
      }

      default:
        throw new Error(`Unknown MCP settings action: ${action}`);
    }

    return {
      settingsUpdate: createSettingsUpdate({
        status: "applied",
        action,
        key,
        title,
        summary,
        changes,
      }),
    };
  }

  async startOAuth(connectorId, redirectUri) {
    const connector = this.getConfig().connectors.find((item) => item.id === connectorId);
    if (!connector) throw new Error(`MCP connector "${connectorId}" not found`);
    const { url, session } = await createMcpOAuthAuthorization({
      connector,
      redirectUri,
      fetchImpl: this.fetchImpl,
    });
    this.oauthSessions.set(session.state, { status: "pending", ...session });
    return { sessionId: session.state, url };
  }

  /**
   * Abandon whatever OAuth waits this connector has in flight.
   *
   * The user gave up on the browser round trip, so the wait ends here. The
   * session is kept (rather than deleted) in the cancelled state: the redirect
   * may still arrive afterwards, and completeOAuth must be able to tell "the
   * user cancelled this" apart from "no such session".
   */
  cancelOAuth(connectorId) {
    let cancelled = 0;
    for (const session of this.oauthSessions.values()) {
      if (session.connectorId !== connectorId) continue;
      if (session.status !== "pending") continue;
      session.status = "cancelled";
      cancelled += 1;
    }
    return { cancelled };
  }

  async completeOAuth({ state, code, error }) {
    const session = this.oauthSessions.get(state);
    if (!session) throw new Error("OAuth session not found");
    // A late redirect must not reopen a wait the user already called off.
    if (session.status === "cancelled") throw new Error("OAuth session was cancelled");
    if (error) {
      session.status = "error";
      session.error = error;
      return session;
    }
    try {
      const token = await exchangeMcpOAuthCode({
        tokenEndpoint: session.tokenEndpoint,
        code,
        redirectUri: session.redirectUri,
        clientId: session.clientId,
        clientSecret: session.clientSecret,
        codeVerifier: session.codeVerifier,
        resource: session.resource,
        fetchImpl: this.fetchImpl,
      });
      // Full authorization (user logged in): persist the token AND any client
      // registration the session obtained via DCR, then stop so the next start
      // rebuilds the live client against the new credentials.
      await this.saveConnectorOAuth(session.connectorId, token, {
        clientRegistration: {
          clientId: stringOrEmpty(session.clientId),
          clientSecret: stringOrEmpty(session.clientSecret),
          clientIdSource: stringOrEmpty(session.clientIdSource),
        },
      });
      session.status = "done";
      session.result = { connectorId: session.connectorId };
      return session;
    } catch (err) {
      session.status = "error";
      session.error = err.message;
      throw err;
    }
  }

  getOAuthStatus(sessionId) {
    const session = this.oauthSessions.get(sessionId);
    if (!session) return { status: "missing" };
    if (session.status === "done") return { status: "done", result: session.result || null };
    if (session.status === "error") return { status: "error", error: session.error || "OAuth failed" };
    if (session.status === "cancelled") return { status: "cancelled" };
    return { status: "pending" };
  }

  // Full-authorization write-back (initial login / re-login). Persists the token
  // and any DCR client registration, then STOPS the connector so the next start
  // rebuilds the live client (which snapshots the connector) against the new
  // credentials. This is the only OAuth write path that tears down the client.
  async saveConnectorOAuth(connectorId, token, { clientRegistration = null } = {}) {
    this._writeConnectorOAuth(connectorId, token, clientRegistration);
    const saved = await this.stopConnector(connectorId).then(() => this.getConfig());
    const connector = saved.connectors.find((item) => item.id === connectorId);
    if (!connector) throw new Error(`MCP connector "${connectorId}" not found after OAuth save`);
    if (!stringOrEmpty(connector.oauth?.accessToken)) {
      throw new Error(`OAuth token was not persisted for MCP connector "${connectorId}"`);
    }
    return connector;
  }

  // Pure persistence of OAuth credentials onto a connector. No client lifecycle
  // side effects — callers decide whether to stop/restart. Centralizing the
  // write keeps the oauth/expiresAt/DCR fields in exactly one place.
  _writeConnectorOAuth(connectorId, token, clientRegistration = null) {
    const config = this.getConfig();
    const connector = config.connectors.find((item) => item.id === connectorId);
    if (!connector) throw new Error(`MCP connector "${connectorId}" not found`);
    connector.authType = "oauth";
    connector.authorizationToken = "";
    if (clientRegistration?.clientId) {
      connector.oauthClientId = clientRegistration.clientId;
      connector.oauthClientSecret = clientRegistration.clientSecret || "";
      connector.clientIdSource = clientRegistration.clientIdSource || "manual";
    }
    connector.oauth = {
      ...token,
      expiresAt: token.expiresIn ? token.obtainedAt + token.expiresIn * 1000 : 0,
    };
    return this.saveConfig(config);
  }

  // Return a usable access token for a connector, refreshing it in place when it
  // is within 60s of expiry (RFC 6749 §6). The refreshed token is written back
  // WITHOUT stopping the connector — a live client picks it up via the injected
  // getAuthToken callback, so an in-use session is never torn down by a refresh.
  // Concurrent callers are deduplicated onto a single in-flight refresh promise.
  async getValidToken(connectorId) {
    const connector = this.getConfig().connectors.find((item) => item.id === connectorId);
    const oauth = connector?.oauth || {};
    const accessToken = stringOrEmpty(oauth.accessToken);
    const refreshToken = stringOrEmpty(oauth.refreshToken);
    const expiresAt = Number(oauth.expiresAt || 0) || 0;
    const nearExpiry = expiresAt > 0 && Date.now() > expiresAt - OAUTH_REFRESH_LEEWAY_MS;
    if (!nearExpiry || !refreshToken) return accessToken;
    return this._refreshConnectorToken(connectorId);
  }

  // Force a refresh if the connector still has a refresh token, returning the new
  // access token (or "" if refresh is impossible). Used by the 401 self-heal path.
  async refreshIfPossible(connectorId) {
    const connector = this.getConfig().connectors.find((item) => item.id === connectorId);
    const refreshToken = stringOrEmpty(connector?.oauth?.refreshToken);
    if (!refreshToken) return "";
    return this._refreshConnectorToken(connectorId);
  }

  // Single in-flight refresh per connector: many requests hitting a near-expiry
  // (or 401) at once must not fire N parallel refreshes that race each other's
  // write-back. The first caller starts the refresh; the rest await the same
  // promise. The map entry is cleared on settle so a later expiry refreshes anew.
  _refreshConnectorToken(connectorId) {
    const inFlight = this.refreshInFlight.get(connectorId);
    if (inFlight) return inFlight;
    const promise = this._doRefreshConnectorToken(connectorId)
      .finally(() => {
        if (this.refreshInFlight.get(connectorId) === promise) {
          this.refreshInFlight.delete(connectorId);
        }
      });
    this.refreshInFlight.set(connectorId, promise);
    return promise;
  }

  async _doRefreshConnectorToken(connectorId) {
    const connector = this.getConfig().connectors.find((item) => item.id === connectorId);
    if (!connector) throw new Error(`MCP connector "${connectorId}" not found`);
    const oauth = connector.oauth || {};
    const refreshToken = stringOrEmpty(oauth.refreshToken);
    if (!refreshToken) throw new Error(`MCP connector "${connectorId}" has no refresh token`);
    const token = await refreshMcpOAuthToken({
      tokenEndpoint: stringOrEmpty(oauth.tokenEndpoint),
      refreshToken,
      clientId: stringOrEmpty(connector.oauthClientId),
      clientSecret: stringOrEmpty(connector.oauthClientSecret),
      scope: stringOrEmpty(oauth.scope),
      resource: stringOrEmpty(connector.url),
      fetchImpl: this.fetchImpl,
    });
    // Refresh write-back: persist WITHOUT stopping the connector.
    this._writeConnectorOAuth(connectorId, token);
    return stringOrEmpty(token.accessToken);
  }

  async logoutOAuth(connectorId) {
    const config = this.getConfig();
    const connector = config.connectors.find((item) => item.id === connectorId);
    if (!connector) throw new Error(`MCP connector "${connectorId}" not found`);
    connector.oauth = {};
    connector.authorizationToken = "";
    const saved = this.saveConfig(config);
    await this.stopConnector(connectorId);
    return saved.connectors.find((item) => item.id === connectorId);
  }

  _requireApp(connectorId, toolName) {
    const connector = this.getConfig().connectors.find((item) => item.id === connectorId);
    if (!connector) throw new Error(`MCP connector "${connectorId}" not found`);
    const tool = connector.tools.find((item) => item.name === toolName);
    if (!tool) throw new Error(`MCP connector tool "${connectorId}/${toolName}" not found`);
    const app = appForConnectorTool(connector, tool);
    if (!app?.resourceUri) throw new Error(`MCP connector tool "${connectorId}/${toolName}" does not expose an app resource`);
    if (!toolVisibilityIncludes(app.visibility, "app")) {
      throw new Error(`MCP connector tool "${connectorId}/${toolName}" is not visible to apps`);
    }
    return app;
  }

  _requireAppVisibleTool(connectorId, toolName) {
    const connector = this.getConfig().connectors.find((item) => item.id === connectorId);
    if (!connector) throw new Error(`MCP connector "${connectorId}" not found`);
    const tool = connector.tools.find((item) => item.name === toolName);
    if (!tool) throw new Error(`MCP connector tool "${connectorId}/${toolName}" not found`);
    const visibility = toolVisibility(tool);
    if (!toolVisibilityIncludes(visibility, "app")) {
      throw new Error(`MCP connector tool "${connectorId}/${toolName}" is not visible to apps`);
    }
    return tool;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Attach the app card to a tool result so the caller can render the connector's
// own UI resource alongside the textual result.
function appendMcpAppCard(result, appCard) {
  const existingDetails = result?.details;
  const details = isPlainObject(existingDetails) ? { ...existingDetails } : {};
  return {
    ...result,
    details: {
      ...details,
      mcpAppCard: {
        type: "mcp_app",
        connectorId: appCard.connectorId,
        serverId: appCard.connectorId,
        toolName: appCard.toolName,
        resourceUri: appCard.resourceUri,
        invocationId: appCard.invocationId || appCard.toolCallId || "",
        toolCallId: appCard.toolCallId || appCard.invocationId || "",
        launchInput: appCard.launchInput || {},
        title: appCard.title || appCard.toolName,
        description: appCard.description || "",
        sourceSessionPath: appCard.sourceSessionPath || "",
        sourceSessionId: appCard.sourceSessionId || "",
        sourceAgentId: appCard.sourceAgentId || "",
      },
    },
  };
}

function appsForConnector(connector) {
  return (connector.tools || [])
    .map((tool) => appForConnectorTool(connector, tool))
    .filter((app) => app && toolVisibilityIncludes(app.visibility, "app"));
}

function appForConnectorTool(connector, tool) {
  const resourceUri = toolResourceUri(tool);
  if (!resourceUri) return null;
  const visibility = toolVisibility(tool);
  return {
    connectorId: connector.id,
    serverId: connector.id,
    toolName: tool.name,
    title: tool.title || tool.name,
    description: tool.description || "",
    resourceUri,
    visibility,
    inputSchema: tool.inputSchema || { type: "object", properties: {} },
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(tool._meta ? { _meta: tool._meta } : {}),
  };
}

function appCardForConnectorTool(connector, tool) {
  const app = appForConnectorTool(connector, tool);
  if (!app || !toolVisibilityIncludes(app.visibility, "app")) return null;
  return app;
}

// Two dialects declare the same thing — the connector's own `_meta.ui.resourceUri`
// and the `openai/outputTemplate` key — so both are accepted.
function toolResourceUri(tool) {
  const meta = isPlainObject(tool?._meta) ? tool._meta : {};
  const ui = isPlainObject(meta.ui) ? meta.ui : {};
  const uri = stringOrEmpty(ui.resourceUri) || stringOrEmpty(meta["openai/outputTemplate"]);
  return isUiResourceUri(uri) ? uri : "";
}

// Only ui:// resources may be fetched through the app resource endpoint: it is
// the boundary that keeps a connector from pointing the reader at arbitrary URIs.
function isUiResourceUri(uri) {
  return typeof uri === "string" && uri.startsWith("ui://");
}

function toolVisibility(tool) {
  const meta = isPlainObject(tool?._meta) ? tool._meta : {};
  const ui = isPlainObject(meta.ui) ? meta.ui : {};
  if (!Object.prototype.hasOwnProperty.call(ui, "visibility")) return [...DEFAULT_TOOL_VISIBILITY];
  const raw = ui.visibility;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((item) => stringOrEmpty(item)).filter(Boolean))];
}

function toolVisibilityIncludes(visibility, value) {
  const normalized = Array.isArray(visibility) ? visibility : DEFAULT_TOOL_VISIBILITY;
  return normalized.includes(value);
}

// Classify a reconnect/start error as auth-terminal (re-auth required, retrying
// is futile). Delegates to the shared classifier so the rule is identical at the
// live-request layer (_failLiveSession) and here: an HTTP 401/403, OR a dead
// refresh token surfacing as an OAuth invalid_grant (HTTP 400) from the
// pre-request refresh during start(). Used to short-circuit reconnect into
// needs-auth instead of burning the whole backoff budget re-hammering the AS.
function isAuthError(err) {
  return isAuthTerminalError(err);
}

function normalizeBoolean(value, fieldName) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`${fieldName} must be boolean`);
}

function connectorIdFromPayload(payload) {
  const id = sanitizeId(payload.connectorId || payload.serverId || payload.id);
  if (!id) throw new Error("connectorId is required");
  return id;
}

function connectorInputFromPayload(payload) {
  const source = isPlainObject(payload.connector) ? payload.connector : payload;
  return omitKeys(source, ["connector", "connectorId", "serverId", "enableGlobal", "enabled", "value"]);
}

function connectorPatchFromPayload(payload) {
  const source = isPlainObject(payload.patch) ? payload.patch : payload;
  return omitKeys(source, ["connectorId", "serverId", "id", "patch", "value"]);
}

function omitKeys(source, keys) {
  const blocked = new Set(keys);
  return Object.fromEntries(
    Object.entries(source || {}).filter(([key]) => !blocked.has(key)),
  );
}

// Transport and protocol era are orthogonal: this picks the transport only.
// Which protocol revision gets spoken over that transport is settled inside the
// client, by probing the server (or by an operator-pinned protocolVersion), so
// naming a transport here never pins a connector to the legacy handshake. The
// deprecated HTTP+SSE transport is the one exception — it predates the stateless
// endpoint and has nothing to negotiate.
function createDefaultClient(connector, opts) {
  if (connector.transport === "stdio") return new McpStdioClient(connector, opts);
  if (connector.transport === "streamable-http") return new McpStreamableHttpClient(connector, opts);
  if (connector.transport === "sse") return new McpLegacySseClient(connector, opts);
  return new McpAutoHttpClient(connector, opts);
}

function normalizeTransport(connector) {
  const raw = stringOrEmpty(connector.transport || connector.type);
  if (raw === "http") return "remote";
  if (raw === "streamableHttp" || raw === "streamable-http") return "streamable-http";
  if (TRANSPORTS.has(raw)) return raw;
  if (stringOrEmpty(connector.url || connector.baseUrl)) return "remote";
  return "stdio";
}

function normalizeAuthType(value, { authorizationToken, oauth, connector }) {
  const raw = stringOrEmpty(value);
  if (AUTH_TYPES.has(raw)) return raw;
  if (authorizationToken) return "bearer";
  if (oauth.accessToken || connector.oauthClientId || connector.clientId) return "oauth";
  return "none";
}

function normalizeClientIdSource(connector) {
  const raw = stringOrEmpty(connector.clientIdSource);
  if (raw === "manual" || raw === "dcr") return raw;
  return stringOrEmpty(connector.oauthClientId || connector.clientId) ? "manual" : "";
}

function normalizeOAuthState(value) {
  if (!value || typeof value !== "object") return {};
  return {
    accessToken: stringOrEmpty(value.accessToken),
    refreshToken: stringOrEmpty(value.refreshToken),
    tokenType: stringOrEmpty(value.tokenType) || (value.accessToken ? "Bearer" : ""),
    tokenEndpoint: stringOrEmpty(value.tokenEndpoint),
    scope: stringOrEmpty(value.scope),
    expiresIn: Number(value.expiresIn || 0) || 0,
    expiresAt: Number(value.expiresAt || 0) || 0,
    obtainedAt: Number(value.obtainedAt || 0) || 0,
  };
}

function validateConnector(connector) {
  if (!connector) throw new Error("connector is required");
  if (connector.transport === "stdio") {
    if (!connector.command) throw new Error("command is required");
    return;
  }
  if (!connector.url) throw new Error("url is required");
  let url;
  try {
    url = new URL(connector.url);
  } catch {
    // The platform's bare "Invalid URL" says nothing about which field or which
    // value, and it used to reach the user verbatim in a toast.
    throw new Error(`url "${connector.url}" is not a valid URL — include the scheme, e.g. https://example.com/mcp`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("url must use http or https");
  }
}

function uniqueConnectorId(connectors, raw) {
  const base = sanitizeId(raw) || "connector";
  const taken = new Set(connectors.map((s) => s.id));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function connectorClientFingerprint(connector) {
  return JSON.stringify({
    transport: connector.transport,
    url: connector.url,
    command: connector.command,
    args: connector.args,
    cwd: connector.cwd,
    env: connector.env,
    headers: connector.headers,
    registryUrl: connector.registryUrl,
    timeout: connector.timeout,
    authType: connector.authType,
    authorizationToken: connector.authorizationToken,
    oauthAccessToken: connector.oauth?.accessToken || "",
  });
}

function publicConnector({ connector, status, error = "", toolListFreshness = null, toolAnnotations = null }: any) {
  return {
    ...connector,
    // Live annotations ride along the runtime view only, so surfaces can badge
    // a tool read-only or destructive. They are never part of the persisted
    // connector: saveConfig normalizes through normalizeTool, which drops them.
    tools: (connector.tools || []).map((tool) => {
      const annotations = toolAnnotations?.get(tool.name);
      // The agent-facing identity travels with the tool so surfaces can match a
      // pending invocation back to its connector without re-deriving the
      // id-sanitizing rules. Two implementations of that rule would drift.
      const qualifiedName = toMcpToolId(connector.id, tool.name);
      const identified = { ...tool, qualifiedName, capability: `${qualifiedName}.invoke` };
      return annotations ? { ...identified, annotations } : identified;
    }),
    status,
    error,
    toolListFreshness,
    apps: appsForConnector(connector),
    env: redactRecord(connector.env),
    headers: redactRecord(connector.headers),
    authorizationToken: connector.authorizationToken ? "********" : "",
    oauthClientSecret: connector.oauthClientSecret ? "********" : "",
    oauth: {
      connected: !!connector.oauth?.accessToken,
      scope: connector.oauth?.scope || "",
      expiresAt: connector.oauth?.expiresAt || 0,
    },
    proxy: resolveMcpHttpProxyDiagnostics(connector),
    authStatus: connectorAuthStatus(connector),
  };
}

function connectorAuthStatus(connector) {
  if (connector.authType === "none") return "none";
  if (connector.authType === "bearer") return connector.authorizationToken ? "token" : "missing";
  if (connector.authType === "oauth") return connector.oauth?.accessToken ? "connected" : "disconnected";
  return "none";
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key, val]) => typeof key === "string" && typeof val === "string"),
  );
}

function normalizeTimeoutSeconds(value) {
  if (value === "" || value == null) return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function redactRecord(value) {
  const record = normalizeStringRecord(value);
  return Object.fromEntries(
    Object.entries(record).map(([key, val]) => [key, val ? MASKED_SECRET : ""]),
  );
}

function unmaskConnectorPatch(existing, patch) {
  const next = { ...patch };
  if (patch.authorizationToken === MASKED_SECRET) {
    next.authorizationToken = existing.authorizationToken || "";
  }
  if (patch.oauthClientSecret === MASKED_SECRET) {
    next.oauthClientSecret = existing.oauthClientSecret || "";
  }
  if (patch.env && typeof patch.env === "object" && !Array.isArray(patch.env)) {
    next.env = unmaskRecord(existing.env, patch.env);
  }
  if (patch.headers && typeof patch.headers === "object" && !Array.isArray(patch.headers)) {
    next.headers = unmaskRecord(existing.headers, patch.headers);
  }
  return next;
}

function unmaskRecord(existing, patch) {
  const existingRecord = normalizeStringRecord(existing);
  const patchRecord = normalizeStringRecord(patch);
  return Object.fromEntries(
    Object.entries(patchRecord).map(([key, val]) => [
      key,
      val === MASKED_SECRET && Object.hasOwn(existingRecord, key) ? existingRecord[key] : val,
    ]),
  );
}

export function configPathForDataDir(dataDir) {
  return path.join(dataDir, "config.json");
}

/** Historical name of the class, kept so older import sites keep resolving. */
export { McpManager as McpRuntime };
