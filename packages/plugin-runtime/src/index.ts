import type {
  PluginResourceDescriptor,
  PluginResourceEdit,
  PluginResourceListItem,
  PluginResourceListResult,
  PluginResourceMaterializeResult,
  PluginResourceMoveResult,
  PluginResourceReadResult,
  PluginResourceRef,
  PluginResourceSearchMatch,
  PluginResourceSearchOptions,
  PluginResourceSearchResult,
  PluginResourceStat,
  PluginResourceTrashOptions,
  PluginResourceTrashResult,
  PluginResourceVersion,
  PluginResourceWatchTarget,
  PluginResourceWriteConflictResult,
  PluginResourceWriteExpectedVersionResult,
  PluginResourceMutationResult,
} from '@jarvis/plugin-protocol';

export type MaybePromise<T> = T | Promise<T>;

export type JsonSchema = Record<string, unknown>;

export const JARVIS_BUS_SKIP = Symbol.for('jarvis.event-bus.skip');

export interface JarvisToolResult {
  content?: Array<Record<string, unknown>>;
  details?: Record<string, unknown>;
}

export interface JarvisSessionRef {
  sessionId: string;
  sessionPath?: string | null;
  legacySessionPath?: string | null;
}

export type JarvisSessionTarget = string | JarvisSessionRef | {
  sessionId?: string | null;
  sessionPath?: string | null;
  path?: string | null;
  legacySessionPath?: string | null;
};

export interface JarvisSessionFile {
  id?: string | null;
  fileId?: string | null;
  sessionId?: string | null;
  sessionPath?: string | null;
  filePath?: string;
  realPath?: string;
  displayName?: string;
  filename?: string;
  label?: string;
  ext?: string | null;
  mime?: string;
  size?: number;
  kind?: string;
  isDirectory?: boolean;
  origin?: string;
  operations?: unknown[];
  createdAt?: number | string;
  storageKind?: string;
  status?: string;
  missingAt?: number | string | null;
  resource?: JarvisResourceEnvelope;
  [key: string]: unknown;
}

export interface JarvisResourceEnvelope {
  schemaVersion: 1;
  resourceId: string;
  name: string;
  studioId: string;
  type: 'file' | string;
  source: 'session_file' | string;
  sourceId?: string;
  fileId?: string;
  displayName?: string;
  filename?: string;
  ext?: string | null;
  mime?: string;
  size?: number | null;
  kind?: string;
  isDirectory?: boolean;
  origin?: string;
  operations?: string[];
  createdAt?: number | string;
  mtimeMs?: number;
  lifecycle: {
    status: string;
    missingAt: number | string | null;
  };
  storage: {
    provider: string;
    storageKind?: string;
    localOnly?: boolean;
  };
  links: {
    self: string;
    content?: string;
  };
  [key: string]: unknown;
}

export type JarvisResourceRef = PluginResourceRef;
export type JarvisResourceVersion = PluginResourceVersion;
export type JarvisResourceDescriptor = PluginResourceDescriptor;
export type JarvisResourceStat = PluginResourceStat;
export type JarvisResourceReadResult = PluginResourceReadResult;
export type JarvisResourceMutationResult = PluginResourceMutationResult;
export type JarvisResourceWriteConflictResult = PluginResourceWriteConflictResult;
export type JarvisResourceWriteExpectedVersionResult = PluginResourceWriteExpectedVersionResult;
export type JarvisResourceMoveResult = PluginResourceMoveResult;
export type JarvisResourceTrashOptions = PluginResourceTrashOptions;
export type JarvisResourceTrashResult = PluginResourceTrashResult;
export type JarvisResourceEdit = PluginResourceEdit;
export type JarvisResourceListItem = PluginResourceListItem;
export type JarvisResourceListResult = PluginResourceListResult;
export type JarvisResourceSearchOptions = PluginResourceSearchOptions;
export type JarvisResourceSearchMatch = PluginResourceSearchMatch;
export type JarvisResourceSearchResult = PluginResourceSearchResult;
export type JarvisResourceMaterializeResult = PluginResourceMaterializeResult;
export type JarvisResourceWatchTarget = PluginResourceWatchTarget;

export interface JarvisPluginResourceMutationOptions {
  emit?: boolean;
}

export interface JarvisPluginResourceWatchOptions {
  purpose?: string | null;
  sessionRef?: JarvisSessionRef | { sessionPath?: string | null; path?: string | null } | null;
  /** @deprecated Prefer sessionId/sessionRef on the invocation context. */
  sessionPath?: string | null;
}

export interface JarvisResourceWatchSubscription {
  subscriptionId: string;
  resourceKeys: string[];
  unsubscribe(): boolean;
  close(): boolean;
}

export interface JarvisPluginResources {
  stat(ref: JarvisResourceRef | Record<string, unknown>): Promise<JarvisResourceStat>;
  read(ref: JarvisResourceRef | Record<string, unknown>): Promise<JarvisResourceReadResult>;
  list(ref: JarvisResourceRef | Record<string, unknown>): Promise<JarvisResourceListResult>;
  search(ref: JarvisResourceRef | Record<string, unknown>, options?: JarvisResourceSearchOptions): Promise<JarvisResourceSearchResult>;
  materialize(ref: JarvisResourceRef | Record<string, unknown>): Promise<JarvisResourceMaterializeResult>;
  write(ref: JarvisResourceRef | Record<string, unknown>, content: string | Uint8Array | ArrayBuffer, options?: JarvisPluginResourceMutationOptions): Promise<JarvisResourceMutationResult>;
  writeExpectedVersion(ref: JarvisResourceRef | Record<string, unknown>, content: string | Uint8Array | ArrayBuffer, expectedVersion: JarvisResourceVersion, options?: JarvisPluginResourceMutationOptions): Promise<JarvisResourceWriteExpectedVersionResult>;
  edit(ref: JarvisResourceRef | Record<string, unknown>, edits: JarvisResourceEdit[], options?: JarvisPluginResourceMutationOptions): Promise<JarvisResourceMutationResult>;
  mkdir(ref: JarvisResourceRef | Record<string, unknown>, options?: JarvisPluginResourceMutationOptions): Promise<JarvisResourceMutationResult>;
  delete(ref: JarvisResourceRef | Record<string, unknown>, options?: JarvisPluginResourceMutationOptions): Promise<JarvisResourceMutationResult>;
  copy(from: JarvisResourceRef | Record<string, unknown>, to: JarvisResourceRef | Record<string, unknown>, options?: JarvisPluginResourceMutationOptions): Promise<JarvisResourceMutationResult>;
  rename(from: JarvisResourceRef | Record<string, unknown>, to: JarvisResourceRef | Record<string, unknown>, options?: JarvisPluginResourceMutationOptions): Promise<JarvisResourceMoveResult>;
  move(from: JarvisResourceRef | Record<string, unknown>, to: JarvisResourceRef | Record<string, unknown>, options?: JarvisPluginResourceMutationOptions): Promise<JarvisResourceMoveResult>;
  trash(ref: JarvisResourceRef | Record<string, unknown>, trashOptions?: JarvisResourceTrashOptions, options?: JarvisPluginResourceMutationOptions): Promise<JarvisResourceTrashResult>;
  watch(ref: JarvisResourceRef | Record<string, unknown>, options?: JarvisPluginResourceWatchOptions): JarvisResourceWatchSubscription;
  subscribe(resources: Array<JarvisResourceRef | Record<string, unknown>>, options?: JarvisPluginResourceWatchOptions): JarvisResourceWatchSubscription;
  resolveWatchTarget?(ref: JarvisResourceRef | Record<string, unknown>, options?: JarvisPluginResourceWatchOptions): JarvisResourceWatchTarget;
}

export interface JarvisExecutionBoundary {
  schemaVersion: 1;
  boundaryId: string;
  kind: 'local_process' | string;
  serverNodeId: string;
  studioId: string;
  workbench?: {
    kind: string;
    root: string | null;
    [key: string]: unknown;
  };
  sandbox?: {
    kind: string;
    enforcedBy?: string;
    [key: string]: unknown;
  };
  filesystem?: {
    policy: string;
    [key: string]: unknown;
  };
  network?: {
    policy: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface JarvisSessionFileMediaItem {
  type: 'session_file';
  fileId: string;
  sessionId?: string | null;
  sessionPath?: string | null;
  filePath?: string;
  label?: string;
  mime?: string;
  size?: number;
  kind?: string;
  [key: string]: unknown;
}

export interface JarvisStagedSessionFile {
  file?: JarvisSessionFile | null;
  sessionFile?: JarvisSessionFile | null;
  mediaItem: JarvisSessionFileMediaItem;
}

export interface JarvisMediaDetails {
  media: {
    items: JarvisSessionFileMediaItem[];
  };
}

export interface JarvisChatSurfaceCardOptions {
  title?: string;
  description?: string;
  mode?: 'transcript' | 'full' | string;
  composer?: boolean;
  aspectRatio?: string;
}

export interface JarvisChatSurfaceCardDetails {
  type: 'chat.surface';
  pluginId: string;
  sessionId: string;
  sessionRef: JarvisSessionRef;
  sessionPath?: string;
  title?: string;
  description: string;
  mode: 'transcript' | 'full' | string;
  composer?: boolean;
  aspectRatio?: string;
}

export interface JarvisPluginNetworkFetchInit extends RequestInit {
  timeoutMs?: number;
  cacheTtlMs?: number;
  maxResponseBytes?: number;
}

export interface JarvisPluginNetwork {
  fetch(input: string | URL | Request, init?: JarvisPluginNetworkFetchInit): Promise<Response>;
}

export interface JarvisToolContext {
  serverId: string;
  serverNodeId?: string;
  userId: string;
  studioId: string;
  connectionKind?: 'local' | 'lan' | 'custom_remote' | 'relay' | 'cloud' | string;
  credentialKind?: 'none' | 'loopback_token' | 'device_credential' | 'user_session' | string;
  platformAccountId?: string | null;
  officialServiceKind?: 'relay' | 'cloud_studio' | 'inference' | 'billing' | string | null;
  executionBoundary?: JarvisExecutionBoundary;
  pluginId: string;
  pluginDir: string;
  dataDir: string;
  capabilities?: string[];
  sensitiveCapabilities?: string[];
  sessionId?: string | null;
  sessionRef?: JarvisSessionRef | null;
  /** @deprecated Use sessionId/sessionRef. Kept for legacy plugins. */
  sessionPath?: string | null;
  bus: JarvisEventBus;
  network: JarvisPluginNetwork;
  resources: JarvisPluginResources;
  config: JarvisPluginConfigStore;
  log: JarvisPluginLogger;
  registerSessionFile?: (input: Record<string, unknown>) => JarvisSessionFile;
  stageFile?: (input: Record<string, unknown>) => JarvisStagedSessionFile;
  [key: string]: unknown;
}

export type JarvisToolSessionPermissionKind =
  | 'read'
  | 'read_only'
  | 'plugin_output'
  | 'session_file_output'
  | 'workspace_write'
  | 'external_side_effect'
  | 'review'
  | string;

export type JarvisToolInvocationKind = 'read' | 'routine' | 'review';

export type JarvisToolInvocationTargetType =
  | 'url'
  | 'browser_tab'
  | 'background_task'
  | 'channel'
  | 'channel_draft'
  | 'agent'
  | 'notification_route'
  | 'setting'
  | 'memory_store'
  | 'pinned_memory_item'
  | 'pinned_memory_query'
  | 'experience_category'
  | 'session_files'
  | 'terminal_process';

export interface JarvisToolInvocationTarget {
  type: JarvisToolInvocationTargetType;
  /** Exact wildcard-free identity, limited by the host to 4096 characters. */
  id: string;
  /** Display-only label for reviewer context. */
  label?: string;
}

export interface JarvisToolInvocationDescriptor {
  action: string;
  kind: JarvisToolInvocationKind;
  /** Stable capability id in the form `<tool-name>.<action>`. */
  capability: string;
  target?: JarvisToolInvocationTarget;
  sideEffect?: Record<string, unknown>;
}

export interface JarvisToolSessionPermission<Input = unknown> {
  /**
   * True means the tool only reads already-authorized data and may run in
   * read-only sessions without reviewer escalation.
   */
  readOnly?: boolean;
  /**
   * Host approval classification hint. Unknown or external side-effect kinds
   * remain reviewer-bound in Auto mode.
   */
  kind?: JarvisToolSessionPermissionKind;
  /**
   * Override Auto-mode handling for a declared non-read tool.
   */
  auto?: 'allow' | 'review';
  description?: string;
  sideEffect?: Record<string, unknown>;
  describeSideEffect?: (input: Input) => Record<string, unknown> | null | undefined;
  /**
   * Synchronously classify one concrete invocation. Return null for an
   * unsupported action or invalid target so the host can fail closed.
   * Promise/thenable results are consumed safely and rejected. The descriptor
   * action is the resolver's stable permission action; the host does not infer
   * it from an optional input.action field or require those strings to match.
   *
   * Actor, server, and session identity are host-owned and must not appear in
   * the returned descriptor or sideEffect metadata.
   */
  resolveInvocation?: (input: Input) => JarvisToolInvocationDescriptor | null;
}

export interface JarvisToolDefinition<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  parameters?: JsonSchema;
  promptSnippet?: string;
  promptGuidelines?: string;
  sessionPermission?: JarvisToolSessionPermission<Input>;
  metadata?: Record<string, unknown>;
  invocationStyle?: 'sdk_tool' | 'pi_tool';
  execute(input: Input, ctx: JarvisToolContext): MaybePromise<Output>;
}

export type JarvisSlashPermission = 'anyone' | 'owner' | 'admin';
export type JarvisSlashScope = 'session' | 'global';

export interface JarvisCommandContext {
  [key: string]: unknown;
}

export interface JarvisCommandResult {
  reply?: string;
  silent?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface JarvisCommandDefinition<Context = JarvisCommandContext> {
  name: string;
  aliases?: string[];
  description?: string;
  scope?: JarvisSlashScope;
  permission?: JarvisSlashPermission;
  usage?: string;
  handler?: (ctx: Context) => MaybePromise<JarvisCommandResult | void>;
  execute?: (ctx: Context) => MaybePromise<unknown>;
}

export type JarvisProviderRuntimeKind = 'http' | 'oauth-http' | 'local-cli' | 'browser-cli' | 'plugin';
export type JarvisMediaCapabilityName = 'imageGeneration' | 'videoGeneration' | 'speechGeneration' | string;
export type JarvisMediaOutputKind = 'file_glob' | 'json_stdout' | 'url_stdout';
export type JarvisCliBindingSource = 'prompt' | 'modelId' | 'inputFile' | 'outputDir' | 'size' | 'duration';

export type JarvisCliArgBinding =
  | { literal: string }
  | { option: string; from: JarvisCliBindingSource };

export interface JarvisCliOutputContract {
  kind: JarvisMediaOutputKind;
  directory?: JarvisCliBindingSource | string;
  pattern?: string;
  [key: string]: unknown;
}

export interface JarvisCliCommandSpec {
  executable: string;
  args: JarvisCliArgBinding[];
  timeoutMs: number;
  output: JarvisCliOutputContract;
}

export interface JarvisProviderRuntime {
  kind: JarvisProviderRuntimeKind;
  protocolId?: string;
  command?: JarvisCliCommandSpec;
  [key: string]: unknown;
}

export interface JarvisProviderChatCapability {
  projection?: 'models-json' | 'sdk-auth-alias' | 'none' | string;
  credentialSource?: 'provider-catalog' | 'auth-storage' | 'none';
  runtimeProviderId?: string;
  displayProviderId?: string;
  allowListSource?: string;
  [key: string]: unknown;
}

export interface JarvisMediaReferenceImageLimits {
  min?: number;
  max?: number;
  [key: string]: unknown;
}

export interface JarvisMediaInputLimits {
  referenceImages?: JarvisMediaReferenceImageLimits;
  [key: string]: unknown;
}

export interface JarvisProviderMediaMode {
  id: string;
  label?: string;
  parameterSchema?: JsonSchema;
  defaults?: Record<string, unknown>;
  inputLimits?: JarvisMediaInputLimits;
  pricing?: Record<string, unknown>;
  agentHints?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface JarvisProviderMediaModel {
  id: string;
  displayName?: string;
  protocolId: string;
  inputs?: string[];
  outputs?: string[];
  supportsEdit?: boolean;
  aliases?: string[];
  credentialLaneId?: string;
  modes?: JarvisProviderMediaMode[];
  parameterSchema?: JsonSchema;
  defaults?: Record<string, unknown>;
  inputLimits?: JarvisMediaInputLimits;
  [key: string]: unknown;
}

export interface JarvisProviderCredentialLane {
  id: string;
  kind?: string;
  label?: string;
  [key: string]: unknown;
}

export interface JarvisProviderMediaCapability {
  defaultModelId?: string;
  models: JarvisProviderMediaModel[];
  credentialLanes?: JarvisProviderCredentialLane[];
  [key: string]: unknown;
}

export interface JarvisProviderCapabilities {
  chat?: JarvisProviderChatCapability;
  media?: Partial<Record<JarvisMediaCapabilityName, JarvisProviderMediaCapability>>;
  [key: string]: unknown;
}

export interface JarvisProviderSource {
  kind: 'builtin' | 'plugin' | 'user' | string;
  pluginId?: string;
  [key: string]: unknown;
}

export interface JarvisProviderDefinition {
  id: string;
  displayName?: string;
  name?: string;
  authType?: 'api-key' | 'oauth' | 'none' | string;
  authJsonKey?: string;
  defaultBaseUrl?: string;
  defaultApi?: string;
  api?: string;
  models?: unknown[];
  runtime?: JarvisProviderRuntime;
  capabilities?: JarvisProviderCapabilities;
  source?: JarvisProviderSource;
  [key: string]: unknown;
}

export type JarvisExtensionFactory<Pi = unknown> = (pi: Pi) => MaybePromise<void>;

export interface JarvisPluginConfigStore {
  get<T = unknown>(key: string, options?: JarvisPluginConfigScopeOptions): MaybePromise<T | undefined>;
  getAll?(options?: JarvisPluginConfigScopeOptions & { redacted?: boolean }): MaybePromise<Record<string, unknown>>;
  set<T = unknown>(key: string, value: T, options?: JarvisPluginConfigScopeOptions): MaybePromise<void>;
  setMany?(values: Record<string, unknown>, options?: JarvisPluginConfigScopeOptions): MaybePromise<Record<string, unknown>>;
  getSchema?(): JsonSchema;
}

export interface JarvisPluginConfigScopeOptions {
  scope?: 'global' | 'per-agent' | 'per-session';
  agentId?: string;
  sessionId?: string;
  /** @deprecated Use sessionId. Kept for legacy config scopes. */
  sessionPath?: string;
}

export interface JarvisSessionTurnContext {
  system?: string | Array<string | { text: string; label?: string }>;
  beforeUser?: string | Array<string | { text: string; label?: string }>;
  afterUser?: string | Array<string | { text: string; label?: string }>;
  metadata?: Record<string, unknown>;
}

export interface JarvisSessionCreateInput {
  agentId?: string | null;
  cwd?: string | null;
  memoryEnabled?: boolean;
  model?: string | { id?: string; modelId?: string; provider?: string; providerId?: string };
  workspaceFolders?: string[];
  authorizedFolders?: string[];
  thinkingLevel?: string;
  permissionMode?: string;
  ownerPluginId?: string | null;
  kind?: string | null;
  sessionKind?: string | null;
  visibility?: 'public' | 'plugin_private' | 'private' | string;
}

export interface JarvisSessionSendInput {
  text: string;
  context?: JarvisSessionTurnContext | null;
  images?: unknown[];
  videos?: unknown[];
  audios?: unknown[];
  imageAttachmentPaths?: string[];
  videoAttachmentPaths?: string[];
  audioAttachmentPaths?: string[];
  [key: string]: unknown;
}

export interface JarvisSessionListFilter {
  agentId?: string;
  ownerPluginId?: string;
  includePluginPrivate?: boolean;
}

export interface JarvisSessionUpdateInput {
  title?: string;
  pinned?: boolean;
  projectId?: string | null;
  thinkingLevel?: string;
  permissionMode?: string;
  ownerPluginId?: string | null;
  kind?: string | null;
  visibility?: 'public' | 'plugin_private' | 'private' | string;
}

export interface JarvisCreateInput {
  id?: string;
  name: string;
  yuan?: string;
  ownerPluginId?: string | null;
  visibility?: 'public' | 'plugin_private' | 'private' | string;
  kind?: string | null;
  initialFiles?: Record<string, string>;
  initialMemory?: Record<string, unknown>;
  memoryPolicy?: { enabled?: boolean };
}

export interface JarvisUpdateInput {
  name?: string;
  yuan?: string;
  ownerPluginId?: string | null;
  visibility?: 'public' | 'plugin_private' | 'private' | string;
  kind?: string | null;
  memoryPolicy?: { enabled?: boolean };
  toolPolicy?: { disabled?: string[] };
  config?: Record<string, unknown>;
}

export interface JarvisModelSampleInput {
  systemPrompt?: string;
  messages: Array<{ role: string; content: unknown }>;
  sessionId?: string;
  sessionRef?: JarvisSessionRef;
  /** @deprecated Use sessionId/sessionRef. */
  sessionPath?: string;
  agentId?: string;
  temperature?: number;
  maxTokens?: number;
  operation?: string;
}

export interface JarvisMediaProviderFilter {
  capability?: string;
}

export interface JarvisMediaModelRef {
  providerId?: string;
  provider?: string;
  modelId?: string;
  model?: string;
  capability?: string;
  credentialLaneId?: string;
}

export type JarvisSessionFileReference =
  | { kind: 'session_file'; fileId: string }
  | { type: 'session_file'; fileId: string };

export type JarvisGenerateImageReference = JarvisSessionFileReference;

export interface JarvisMediaDelivery {
  mode?: 'session' | 'response' | string;
  ttlMs?: number;
  [key: string]: unknown;
}

export interface JarvisGenerateImageInput {
  sessionId?: string;
  sessionRef?: JarvisSessionRef;
  /** @deprecated Use sessionId/sessionRef. */
  sessionPath?: string;
  prompt: string;
  count?: number;
  image?: JarvisGenerateImageReference | JarvisGenerateImageReference[];
  referenceImages?: JarvisGenerateImageReference[];
  ratio?: string;
  resolution?: string;
  quality?: string;
  mode?: string;
  options?: Record<string, unknown>;
  model?: string;
  provider?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  delivery?: JarvisMediaDelivery;
  deliveryMode?: string;
  deliveryTarget?: unknown;
}

export interface JarvisGenerateVideoInput {
  sessionId?: string;
  sessionRef?: JarvisSessionRef;
  /** @deprecated Use sessionId/sessionRef. */
  sessionPath?: string;
  prompt: string;
  image?: JarvisGenerateImageReference | JarvisGenerateImageReference[] | string;
  referenceImages?: JarvisGenerateImageReference[];
  duration?: number;
  ratio?: string;
  resolution?: string;
  mode?: string;
  options?: Record<string, unknown>;
  model?: string;
  provider?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  delivery?: JarvisMediaDelivery;
  deliveryMode?: string;
  deliveryTarget?: unknown;
}

export interface JarvisGenerateMediaInput {
  kind?: 'image' | 'video' | 'audio' | 'image_generation' | 'video_generation' | 'speech_recognition' | 'asr' | 'transcription' | string;
  type?: string;
  mediaKind?: string;
  sessionId?: string;
  sessionRef?: JarvisSessionRef;
  /** @deprecated Use sessionId/sessionRef. */
  sessionPath?: string;
  fileId?: string;
  prompt?: string;
  image?: JarvisGenerateImageReference | JarvisGenerateImageReference[] | string;
  referenceImages?: JarvisGenerateImageReference[];
  duration?: number;
  ratio?: string;
  resolution?: string;
  quality?: string;
  mode?: string;
  options?: Record<string, unknown>;
  model?: string;
  provider?: string;
  delivery?: JarvisMediaDelivery;
  deliveryMode?: string;
  input?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface JarvisTranscribeAudioInput {
  sessionId?: string;
  sessionRef?: JarvisSessionRef;
  /** @deprecated Use sessionId/sessionRef. */
  sessionPath?: string;
  fileId: string;
  language?: string;
  providerId?: string;
  provider?: string;
  modelId?: string;
  model?: string;
}

export interface JarvisTranscribeAudioResult {
  ok: true;
  transcription: unknown;
  taskId?: string;
  stream?: unknown;
}

export interface JarvisEventBus {
  emit(event: unknown, sessionPath?: string | null): unknown;
  emit(type: string, payload?: unknown): unknown;
  subscribe(callback: (event: unknown, sessionPath?: string | null) => void, filter?: JarvisBusSubscriptionFilter): () => void;
  subscribe(type: string, handler: (payload: unknown) => void): () => void;
  request<T = unknown>(type: string, payload?: unknown, options?: Record<string, unknown>): Promise<T>;
  hasHandler?(type: string): boolean;
  handle?(type: string, handler: (payload: unknown) => MaybePromise<unknown>): () => void;
  listCapabilities?(): JarvisEventBusCapability[];
  getCapability?(type: string): JarvisEventBusCapability | null;
}

export interface JarvisPluginRouteRequestContext {
  pluginId: string;
  agentId: string | null;
  principal: Record<string, unknown> | null;
  capabilityGrant: {
    accessLevel: string;
    declaredPermissions: readonly string[];
    legacyDeclaration: boolean;
  };
  bus: Pick<JarvisEventBus, 'request' | 'emit' | 'subscribe' | 'hasHandler' | 'getCapability' | 'listCapabilities'>;
}

export interface JarvisPluginHonoLikeContext {
  get?(name: string): unknown;
}

export function getPluginRequestContext(c: JarvisPluginHonoLikeContext): JarvisPluginRouteRequestContext {
  if (!c || typeof c.get !== 'function') {
    throw new Error('getPluginRequestContext requires a Hono context with c.get(name)');
  }
  const requestContext = c.get('pluginRequestContext');
  if (!requestContext || typeof requestContext !== 'object') {
    throw new Error('getPluginRequestContext must be called inside a Jarvis plugin route handler');
  }
  const bus = (requestContext as Record<string, unknown>).bus;
  const request = bus && typeof bus === 'object'
    ? (bus as { request?: unknown }).request
    : null;
  if (typeof request !== 'function') {
    throw new Error('getPluginRequestContext found an invalid plugin route request context');
  }
  return requestContext as JarvisPluginRouteRequestContext;
}

export interface JarvisBusSubscriptionFilter {
  types?: string[] | Set<string>;
  [key: string]: unknown;
}

export interface JarvisEventBusCapability {
  type: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  permission: string;
  errors: string[];
  stability: string;
  owner: string;
  since?: string;
  available?: boolean;
}

export interface JarvisNormalizedUsage {
  input: {
    totalTokens: number | null;
    uncachedTokens: number | null;
  };
  output: {
    totalTokens: number | null;
    reasoningTokens: number | null;
  };
  cache: {
    readTokens: number | null;
    writeTokens: number | null;
    missTokens: number | null;
    hit: boolean | null;
    created: boolean | null;
    hitRatio: number | null;
    support: 'reported' | 'not_reported' | 'not_supported';
  };
  totalTokens: number | null;
  costTotal: number | null;
}

export type JarvisUsageAttribution =
  | { kind: 'session'; agentId: string | null; sessionId?: string | null; sessionPath?: string | null }
  | { kind: 'phone_conversation'; agentId: string; conversationId: string; conversationType: 'channel' | 'dm'; sessionId?: string | null; sessionPath?: string | null }
  | { kind: 'memory'; agentId: string | null }
  | { kind: 'automation'; jobId?: string | null; runId?: string | null; agentId?: string | null }
  | { kind: 'plugin'; pluginId: string; agentId?: string | null; sessionId?: string | null; sessionPath?: string | null }
  | { kind: 'utility'; agentId?: string | null; sessionId?: string | null; sessionPath?: string | null }
  | { kind: 'unknown' };

export interface JarvisUsageSource {
  subsystem: 'session' | 'phone' | 'memory' | 'automation' | 'subagent' | 'compaction' | 'plugin' | 'utility' | 'vision' | 'unknown' | string;
  operation: string;
  surface: 'desktop' | 'mobile' | 'bridge' | 'channel' | 'dm' | 'cron' | 'heartbeat' | 'system' | 'plugin' | 'unknown' | string;
  trigger: 'user' | 'manual' | 'threshold' | 'overflow' | 'daily' | 'scheduled' | 'startup' | 'tool' | 'unknown' | string;
  actor?: {
    kind: 'session' | 'phone_conversation' | 'automation' | 'plugin' | 'subagent' | 'unknown' | string;
    agentId?: string | null;
    sessionId?: string | null;
    sessionPath?: string | null;
    taskId?: string | null;
    [key: string]: unknown;
  };
  parent?: {
    kind: 'session' | 'phone_conversation' | 'automation' | 'plugin' | 'unknown' | string;
    sessionId?: string;
    sessionPath?: string;
    conversationId?: string;
    conversationType?: 'channel' | 'dm';
    taskId?: string;
    pluginId?: string;
    [key: string]: unknown;
  };
}

export interface JarvisUsageLedgerEntry {
  schemaVersion: 1;
  requestId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  status: 'ok' | 'error' | 'aborted' | 'usage_missing';
  source: JarvisUsageSource;
  attribution: JarvisUsageAttribution;
  model: {
    provider: string | null;
    modelId: string | null;
    api: string | null;
  };
  usage: JarvisNormalizedUsage | null;
  rawUsageShape: string | null;
  error: {
    name: string | null;
    message: string | null;
  } | null;
}

export interface JarvisUsageListFilter {
  since?: string;
  until?: string;
  attributionKind?: string;
  sessionId?: string;
  sessionPath?: string;
  agentId?: string;
  subsystem?: string;
  operation?: string;
  modelId?: string;
  provider?: string;
  status?: 'ok' | 'error' | 'aborted' | 'usage_missing' | string;
  limit?: number;
}

export interface JarvisUsageListResult {
  entries: JarvisUsageLedgerEntry[];
  nextCursor: string | null;
}

export interface JarvisUsageEventMeta {
  sessionId?: string | null;
  sessionPath?: string | null;
  sessionRef?: JarvisSessionRef | null;
}

export interface JarvisPluginLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface JarvisBusHandlerContext {
  serverId: string;
  serverNodeId?: string;
  userId: string;
  studioId: string;
  connectionKind?: 'local' | 'lan' | 'custom_remote' | 'relay' | 'cloud' | string;
  credentialKind?: 'none' | 'loopback_token' | 'device_credential' | 'user_session' | string;
  platformAccountId?: string | null;
  officialServiceKind?: 'relay' | 'cloud_studio' | 'inference' | 'billing' | string | null;
  executionBoundary?: JarvisExecutionBoundary;
  pluginId: string;
  bus: JarvisEventBus;
  network?: JarvisPluginNetwork;
  resources?: JarvisPluginResources;
  config?: JarvisPluginConfigStore;
  log?: JarvisPluginLogger;
  [key: string]: unknown;
}

export interface JarvisBusHandlerDefinition<
  Payload = unknown,
  Result = unknown,
  Context extends JarvisBusHandlerContext = JarvisBusHandlerContext,
> {
  type: string;
  handle(payload: Payload, ctx: Context): MaybePromise<Result>;
}

export interface JarvisPluginContext {
  serverId: string;
  serverNodeId?: string;
  userId: string;
  studioId: string;
  connectionKind?: 'local' | 'lan' | 'custom_remote' | 'relay' | 'cloud' | string;
  credentialKind?: 'none' | 'loopback_token' | 'device_credential' | 'user_session' | string;
  platformAccountId?: string | null;
  officialServiceKind?: 'relay' | 'cloud_studio' | 'inference' | 'billing' | string | null;
  executionBoundary?: JarvisExecutionBoundary;
  pluginId: string;
  pluginDir: string;
  dataDir: string;
  capabilities?: string[];
  sensitiveCapabilities?: string[];
  sessionId?: string | null;
  sessionRef?: JarvisSessionRef | null;
  /** @deprecated Use sessionId/sessionRef. Kept for legacy plugins. */
  sessionPath?: string | null;
  bus: JarvisEventBus;
  network: JarvisPluginNetwork;
  resources: JarvisPluginResources;
  config: JarvisPluginConfigStore;
  log: JarvisPluginLogger;
  registerTool?: (tool: JarvisToolDefinition) => () => void;
  registerSessionFile?: (input: Record<string, unknown>) => JarvisSessionFile;
  stageFile?: (input: Record<string, unknown>) => JarvisStagedSessionFile;
  [key: string]: unknown;
}

export type JarvisPluginDisposable = () => void;

export interface JarvisPluginLifecycleHelpers {
  register(disposable: JarvisPluginDisposable): void;
}

export interface JarvisPluginLifecycle {
  onload?(ctx: JarvisPluginContext, helpers: JarvisPluginLifecycleHelpers): MaybePromise<void>;
  onunload?(ctx: JarvisPluginContext): MaybePromise<void>;
}

export interface JarvisPluginInstance {
  ctx: JarvisPluginContext;
  register: (disposable: JarvisPluginDisposable) => void;
  onload?(): MaybePromise<void>;
  onunload?(): MaybePromise<void>;
}

export type JarvisTaskStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'blocked'
  | 'recovering'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'aborted';

export interface JarvisTaskProgress {
  current?: number;
  total?: number;
  percent?: number;
  message?: string;
}

export interface JarvisTaskRecord {
  taskId: string;
  type: string;
  parentSessionPath?: string | null;
  pluginId?: string | null;
  agentId?: string | null;
  meta?: Record<string, unknown>;
  progress?: JarvisTaskProgress | null;
  status: JarvisTaskStatus;
  aborted?: boolean;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}

export interface JarvisTaskSchedule {
  scheduleId: string;
  type: string;
  pluginId?: string | null;
  agentId?: string | null;
  parentSessionPath?: string | null;
  payload?: unknown;
  meta?: Record<string, unknown>;
  intervalMs?: number | null;
  runAt?: number | string | null;
  enabled?: boolean;
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  lastResult?: unknown;
  lastError?: string | null;
  runCount?: number;
}

export interface JarvisTaskRegisterInput {
  taskId: string;
  type: string;
  parentSessionPath?: string | null;
  pluginId?: string | null;
  agentId?: string | null;
  meta?: Record<string, unknown>;
  persist?: boolean;
}

export interface JarvisTaskUpdateInput {
  taskId: string;
  status?: JarvisTaskStatus;
  progress?: JarvisTaskProgress | null;
  meta?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
  parentSessionPath?: string | null;
  pluginId?: string | null;
  agentId?: string | null;
}

export interface JarvisTaskScheduleInput {
  scheduleId: string;
  type: string;
  pluginId?: string | null;
  agentId?: string | null;
  parentSessionPath?: string | null;
  payload?: unknown;
  meta?: Record<string, unknown>;
  intervalMs?: number;
  runAt?: number | string | Date;
  enabled?: boolean;
}

const EMPTY_PARAMETERS: JsonSchema = { type: 'object', properties: {} };

export function defineTool<Input = unknown, Output = unknown>(
  definition: JarvisToolDefinition<Input, Output>,
): JarvisToolDefinition<Input, Output> & { parameters: JsonSchema } {
  return {
    ...definition,
    parameters: definition.parameters ?? EMPTY_PARAMETERS,
  };
}

export function defineCommand<Context = JarvisCommandContext>(
  definition: JarvisCommandDefinition<Context>,
): JarvisCommandDefinition<Context> {
  return { ...definition };
}

export function defineProvider<T extends JarvisProviderDefinition>(definition: T): T {
  return definition;
}

export function defineBusHandler<
  Payload = unknown,
  Result = unknown,
  Context extends JarvisBusHandlerContext = JarvisBusHandlerContext,
>(
  definition: JarvisBusHandlerDefinition<Payload, Result, Context>,
): JarvisBusHandlerDefinition<Payload, Result, Context> {
  return { ...definition };
}

export function requestBus<Result = unknown, Payload = unknown>(
  ctx: { bus?: Pick<JarvisEventBus, 'request'> | null },
  type: string,
  payload?: Payload,
  options?: Record<string, unknown>,
): Promise<Result> {
  if (!ctx.bus || typeof ctx.bus.request !== 'function') {
    throw new Error('plugin bus request unavailable');
  }
  return ctx.bus.request<Result>(type, payload, options);
}

function pluginIdFromContext(ctx: { pluginId?: string | null }): string | null {
  return typeof ctx.pluginId === 'string' && ctx.pluginId.length > 0 ? ctx.pluginId : null;
}

function withOwnerPlugin<T extends Record<string, unknown>>(
  ctx: { pluginId?: string | null },
  input: T,
): T {
  const pluginId = pluginIdFromContext(ctx);
  if (!pluginId || input.ownerPluginId) return input;
  return { ...input, ownerPluginId: pluginId };
}

function withContextMetadata(
  ctx: { pluginId?: string | null },
  context: JarvisSessionTurnContext | null | undefined,
): JarvisSessionTurnContext | null | undefined {
  const pluginId = pluginIdFromContext(ctx);
  if (!pluginId) return context;
  if (!context) {
    return { metadata: { pluginId } };
  }
  return {
    ...context,
    metadata: {
      pluginId,
      ...(context.metadata || {}),
    },
  };
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeSessionTarget(target: JarvisSessionTarget): Record<string, unknown> {
  if (typeof target === 'string') return { sessionPath: target };
  if (!target || typeof target !== 'object') return { sessionPath: target as unknown };

  const sessionId = textOrNull((target as any).sessionId);
  const sessionPath = textOrNull((target as any).sessionPath) || textOrNull((target as any).path);
  const legacySessionPath = textOrNull((target as any).legacySessionPath);
  if (!sessionId) {
    return sessionPath ? { sessionPath } : {};
  }

  const sessionRef: JarvisSessionRef = {
    sessionId,
    ...(sessionPath ? { sessionPath } : {}),
    ...(legacySessionPath ? { legacySessionPath } : {}),
  };
  return {
    sessionId,
    ...(sessionPath ? { sessionPath } : {}),
    ...(legacySessionPath ? { legacySessionPath } : {}),
    sessionRef,
  };
}

function sessionRefFromTarget(target: JarvisSessionTarget): JarvisSessionRef | null {
  const payload = normalizeSessionTarget(target);
  return (payload.sessionRef as JarvisSessionRef | undefined) || null;
}

export function createChatSurfaceCard(
  ctx: { pluginId?: string | null },
  target: JarvisSessionTarget,
  options: JarvisChatSurfaceCardOptions = {},
): JarvisChatSurfaceCardDetails {
  const pluginId = pluginIdFromContext(ctx);
  if (!pluginId) {
    throw new Error('createChatSurfaceCard requires ctx.pluginId');
  }
  const payload = normalizeSessionTarget(target);
  const sessionId = textOrNull(payload.sessionId);
  const sessionPath = textOrNull(payload.sessionPath);
  if (!sessionId) {
    throw new Error('createChatSurfaceCard requires sessionId or sessionRef; sessionPath alone is legacy locator metadata');
  }
  const sessionRef: JarvisSessionRef = {
    sessionId,
    ...(sessionPath ? { sessionPath } : {}),
  };
  return {
    type: 'chat.surface',
    pluginId,
    sessionId,
    sessionRef,
    ...(sessionPath ? { sessionPath } : {}),
    ...(options.title ? { title: options.title } : {}),
    description: options.description || 'Plugin private chat session.',
    mode: options.mode || 'transcript',
    ...(options.composer !== undefined ? { composer: options.composer } : {}),
    ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
  };
}

export function createSession(
  ctx: { pluginId?: string | null; bus?: Pick<JarvisEventBus, 'request'> | null },
  input: JarvisSessionCreateInput = {},
  options?: Record<string, unknown>,
): Promise<unknown> {
  return requestBus(ctx, 'session:create', withOwnerPlugin(ctx, { ...input }), options);
}

export function getSession(
  ctx: { bus?: Pick<JarvisEventBus, 'request'> | null },
  target: JarvisSessionTarget,
  options?: Record<string, unknown>,
): Promise<unknown> {
  return requestBus(ctx, 'session:get', normalizeSessionTarget(target), options);
}

export function listSessions(
  ctx: { bus?: Pick<JarvisEventBus, 'request'> | null },
  filter: JarvisSessionListFilter = {},
  options?: Record<string, unknown>,
): Promise<unknown> {
  return requestBus(ctx, 'session:list', filter, options);
}

export function updateSession(
  ctx: { pluginId?: string | null; bus?: Pick<JarvisEventBus, 'request'> | null },
  target: JarvisSessionTarget,
  patch: JarvisSessionUpdateInput,
  options?: Record<string, unknown>,
): Promise<unknown> {
  return requestBus(ctx, 'session:update', {
    ...normalizeSessionTarget(target),
    ...withOwnerPlugin(ctx, { ...patch }),
  }, options);
}

export function sendSessionMessage(
  ctx: { pluginId?: string | null; bus?: Pick<JarvisEventBus, 'request'> | null },
  target: JarvisSessionTarget,
  input: JarvisSessionSendInput,
  options?: Record<string, unknown>,
): Promise<unknown> {
  return requestBus(ctx, 'session:send', {
    ...normalizeSessionTarget(target),
    ...input,
    context: withContextMetadata(ctx, input.context),
  }, options);
}

export function subscribeSessionEvents(
  ctx: { bus?: Pick<JarvisEventBus, 'subscribe'> | null },
  target: JarvisSessionTarget,
  handler: (event: unknown, meta: { sessionId: string | null; sessionPath: string | null; sessionRef: JarvisSessionRef | null }) => void,
): () => void {
  if (!ctx.bus || typeof ctx.bus.subscribe !== 'function') {
    throw new Error('plugin bus subscribe unavailable');
  }
  const filter = normalizeSessionTarget(target);
  const targetRef = sessionRefFromTarget(target);
  return ctx.bus.subscribe((event, scopedSessionPath) => {
    const eventSessionId = event && typeof event === 'object' ? textOrNull((event as any).sessionId) : null;
    const sessionId = eventSessionId || targetRef?.sessionId || null;
    const sessionPath = scopedSessionPath || targetRef?.sessionPath || null;
    const sessionRef = sessionId ? {
      sessionId,
      ...(sessionPath ? { sessionPath } : {}),
      ...(targetRef?.legacySessionPath ? { legacySessionPath: targetRef.legacySessionPath } : {}),
    } : null;
    handler(event, { sessionId, sessionPath, sessionRef });
  }, filter);
}

export function listAgents(
  ctx: { bus?: Pick<JarvisEventBus, 'request'> | null },
  filter: { ownerPluginId?: string; includePluginPrivate?: boolean } = {},
  options?: Record<string, unknown>,
): Promise<unknown> {
  return requestBus(ctx, 'agent:list', filter, options);
}

export function getAgentProfile(
  ctx: { bus?: Pick<JarvisEventBus, 'request'> | null },
  agentId: string,
  options?: Record<string, unknown>,
): Promise<unknown> {
  return requestBus(ctx, 'agent:profile', { agentId }, options);
}

export function createAgent(
  ctx: { pluginId?: string | null; bus?: Pick<JarvisEventBus, 'request'> | null },
  input: JarvisCreateInput,
  options?: Record<string, unknown>,
): Promise<unknown> {
  return requestBus(ctx, 'agent:create', withOwnerPlugin(ctx, { ...input }), options);
}

export function updateAgent(
  ctx: { pluginId?: string | null; bus?: Pick<JarvisEventBus, 'request'> | null },
  agentId: string,
  patch: JarvisUpdateInput,
  options?: Record<string, unknown>,
): Promise<unknown> {
  return requestBus(ctx, 'agent:update', { agentId, ...withOwnerPlugin(ctx, { ...patch }) }, options);
}

export function sampleText(
  ctx: { pluginId?: string | null; bus?: Pick<JarvisEventBus, 'request'> | null },
  input: JarvisModelSampleInput,
  options?: Record<string, unknown>,
): Promise<unknown> {
  return requestBus(ctx, 'model:sample-text', {
    ...input,
    ...(pluginIdFromContext(ctx) ? { pluginId: pluginIdFromContext(ctx) } : {}),
  }, options);
}

export function listMediaProviders(
  ctx: { bus?: Pick<JarvisEventBus, 'request'> | null },
  filter: JarvisMediaProviderFilter = {},
  options?: Record<string, unknown>,
): Promise<unknown> {
  return requestBus(ctx, 'provider:media-providers', filter, options);
}

export function resolveMediaModel(
  ctx: { bus?: Pick<JarvisEventBus, 'request'> | null },
  ref: JarvisMediaModelRef,
  options?: Record<string, unknown>,
): Promise<unknown> {
  return requestBus(ctx, 'provider:resolve-media-model', ref, options);
}

export function generateImage(
  ctx: { pluginId?: string | null; bus?: Pick<JarvisEventBus, 'request'> | null },
  input: JarvisGenerateImageInput,
  options?: Record<string, unknown>,
): Promise<unknown> {
  return requestBus(ctx, 'media:generate-image', {
    ...input,
    ...(pluginIdFromContext(ctx) ? { pluginId: pluginIdFromContext(ctx) } : {}),
  }, options);
}

export function generateVideo(
  ctx: { pluginId?: string | null; bus?: Pick<JarvisEventBus, 'request'> | null },
  input: JarvisGenerateVideoInput,
  options?: Record<string, unknown>,
): Promise<unknown> {
  return requestBus(ctx, 'media:generate-video', {
    ...input,
    ...(pluginIdFromContext(ctx) ? { pluginId: pluginIdFromContext(ctx) } : {}),
  }, options);
}

export function generateMedia(
  ctx: { pluginId?: string | null; bus?: Pick<JarvisEventBus, 'request'> | null },
  input: JarvisGenerateMediaInput,
  options?: Record<string, unknown>,
): Promise<unknown> {
  return requestBus(ctx, 'media:generate', {
    ...input,
    ...(pluginIdFromContext(ctx) ? { pluginId: pluginIdFromContext(ctx) } : {}),
  }, options);
}

export function transcribeAudio(
  ctx: { pluginId?: string | null; bus?: Pick<JarvisEventBus, 'request'> | null },
  input: JarvisTranscribeAudioInput,
  options?: Record<string, unknown>,
): Promise<JarvisTranscribeAudioResult> {
  return requestBus(ctx, 'media:transcribe-audio', {
    ...input,
    ...(pluginIdFromContext(ctx) ? { pluginId: pluginIdFromContext(ctx) } : {}),
  }, options).then(normalizeTranscribeAudioResult);
}

function normalizeTranscribeAudioResult(result: unknown): JarvisTranscribeAudioResult {
  if (result && typeof result === 'object' && (result as any).ok === true
    && Object.prototype.hasOwnProperty.call(result, 'transcription')) {
    return result as JarvisTranscribeAudioResult;
  }
  return { ok: true, transcription: result };
}

export function listUsageEntries(
  ctx: { bus?: Pick<JarvisEventBus, 'request'> | null },
  filter: JarvisUsageListFilter = {},
  options?: Record<string, unknown>,
): Promise<JarvisUsageListResult> {
  return requestBus<JarvisUsageListResult, JarvisUsageListFilter>(ctx, 'usage:list', filter, options);
}

export function subscribeUsageEvents(
  ctx: { bus?: Pick<JarvisEventBus, 'subscribe'> | null },
  handler: (entry: JarvisUsageLedgerEntry, meta: JarvisUsageEventMeta) => void,
): () => void {
  if (!ctx.bus || typeof ctx.bus.subscribe !== 'function') {
    throw new Error('plugin bus subscribe unavailable');
  }
  return ctx.bus.subscribe((event, sessionPath) => {
    if (!event || typeof event !== 'object') return;
    const typed = event as { type?: unknown; entry?: unknown };
    if (typed.type !== 'llm_usage') return;
    const entry = typed.entry as JarvisUsageLedgerEntry;
    const entrySessionId =
      textOrNull((entry as any)?.attribution?.sessionId)
      || textOrNull((entry as any)?.source?.actor?.sessionId)
      || textOrNull((entry as any)?.source?.parent?.sessionId);
    const entrySessionPath =
      textOrNull((entry as any)?.attribution?.sessionPath)
      || textOrNull((entry as any)?.source?.actor?.sessionPath)
      || textOrNull((entry as any)?.source?.parent?.sessionPath)
      || textOrNull(sessionPath);
    handler(entry, {
      ...(entrySessionId ? { sessionId: entrySessionId } : {}),
      sessionPath: entrySessionPath,
      ...(entrySessionId ? {
        sessionRef: {
          sessionId: entrySessionId,
          ...(entrySessionPath ? { sessionPath: entrySessionPath } : {}),
        },
      } : {}),
    });
  }, { types: ['llm_usage'] });
}

export function registerTask(
  ctx: { bus?: Pick<JarvisEventBus, 'request'> | null },
  input: JarvisTaskRegisterInput,
): Promise<{ ok: true }> {
  return requestBus(ctx, 'task:register', input);
}

export function updateTask(
  ctx: { bus?: Pick<JarvisEventBus, 'request'> | null },
  input: JarvisTaskUpdateInput,
): Promise<{ ok: true; task: JarvisTaskRecord }> {
  return requestBus(ctx, 'task:update', input);
}

export function completeTask(
  ctx: { bus?: Pick<JarvisEventBus, 'request'> | null },
  taskId: string,
  result?: unknown,
): Promise<{ ok: true; task: JarvisTaskRecord }> {
  return requestBus(ctx, 'task:complete', { taskId, result });
}

export function failTask(
  ctx: { bus?: Pick<JarvisEventBus, 'request'> | null },
  taskId: string,
  error: unknown,
): Promise<{ ok: true; task: JarvisTaskRecord }> {
  return requestBus(ctx, 'task:fail', { taskId, error });
}

export function cancelTask(
  ctx: { bus?: Pick<JarvisEventBus, 'request'> | null },
  taskId: string,
  reason?: string,
): Promise<{ result: string; canceled: boolean }> {
  return requestBus(ctx, 'task:cancel', { taskId, reason });
}

export function scheduleTask(
  ctx: { bus?: Pick<JarvisEventBus, 'request'> | null },
  input: JarvisTaskScheduleInput,
): Promise<{ ok: true; schedule: JarvisTaskSchedule }> {
  return requestBus(ctx, 'task:schedule', input);
}

export function unscheduleTask(
  ctx: { bus?: Pick<JarvisEventBus, 'request'> | null },
  scheduleId: string,
): Promise<{ ok: true; removed: boolean }> {
  return requestBus(ctx, 'task:unschedule', { scheduleId });
}

export function sessionFileToMediaItem(file: JarvisSessionFile): JarvisSessionFileMediaItem {
  const fileId = firstText(file.fileId, file.id);
  if (!fileId) {
    throw new Error('SessionFile media item requires id or fileId');
  }

  const item: JarvisSessionFileMediaItem = {
    type: 'session_file',
    fileId,
  };
  assignDefined(item, 'sessionId', file.sessionId);
  assignDefined(item, 'sessionPath', file.sessionPath);
  assignDefined(item, 'filePath', file.filePath);
  assignDefined(item, 'label', firstText(file.label, file.displayName, file.filename));
  assignDefined(item, 'mime', file.mime);
  assignDefined(item, 'size', file.size);
  assignDefined(item, 'kind', file.kind);
  return item;
}

type JarvisMediaInput = JarvisSessionFile | JarvisSessionFileMediaItem | JarvisStagedSessionFile;

export function createMediaDetails(items: JarvisMediaInput[]): JarvisMediaDetails {
  return {
    media: {
      items: items.map(normalizeMediaItem),
    },
  };
}

export function defineExtension<Pi = unknown>(factory: JarvisExtensionFactory<Pi>): JarvisExtensionFactory<Pi> {
  return factory;
}

export function definePlugin(lifecycle: JarvisPluginLifecycle): new () => JarvisPluginInstance {
  return class DefinedJarvisPlugin implements JarvisPluginInstance {
    ctx!: JarvisPluginContext;
    register!: (disposable: JarvisPluginDisposable) => void;

    async onload(): Promise<void> {
      await lifecycle.onload?.(this.ctx, { register: this.register });
    }

    async onunload(): Promise<void> {
      await lifecycle.onunload?.(this.ctx);
    }
  };
}

function normalizeMediaItem(input: JarvisMediaInput): JarvisSessionFileMediaItem {
  if (isRecord(input) && isRecord(input.mediaItem)) {
    return normalizeSessionFileMediaItem(input.mediaItem);
  }
  if (isRecord(input) && input.type === 'session_file') {
    return normalizeSessionFileMediaItem(input);
  }
  if (isRecord(input)) {
    return sessionFileToMediaItem(input);
  }
  throw new Error('media details item must be a SessionFile, staged file, or session_file media item');
}

function normalizeSessionFileMediaItem(input: Record<string, unknown>): JarvisSessionFileMediaItem {
  if (input.type !== 'session_file') {
    throw new Error('media details item must be a session_file media item');
  }
  const fileId = firstText(input.fileId);
  if (!fileId) {
    throw new Error('SessionFile media item requires fileId');
  }
  return {
    ...input,
    type: 'session_file',
    fileId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function assignDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null) {
    target[key] = value;
  }
}
