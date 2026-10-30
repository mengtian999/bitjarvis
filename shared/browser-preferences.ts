export const BROWSER_AGENT_OPEN_BEHAVIORS = ["smart", "current_tab", "new_tab"] as const;

export type BrowserAgentOpenBehavior = typeof BROWSER_AGENT_OPEN_BEHAVIORS[number];

/**
 * 浏览器后端：
 * - embedded：内嵌浏览器（Electron WebContentsView，隔离 profile）
 * - system：用户真实登录态的 Chrome/Edge（经 CDP 驱动，见 lib/browser/external/*）
 */
export const BROWSER_BACKENDS = ["embedded", "system"] as const;

export type BrowserBackend = typeof BROWSER_BACKENDS[number];

export interface BrowserPreferences {
  acceptCookies: boolean;
  agentOpenBehavior: BrowserAgentOpenBehavior;
  backend: BrowserBackend;
}

export const DEFAULT_BROWSER_PREFERENCES: BrowserPreferences = Object.freeze({
  acceptCookies: true,
  agentOpenBehavior: "smart",
  backend: "embedded",
});

export function normalizeBrowserPreferences(value: unknown = {}): BrowserPreferences {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const agentOpenBehavior = BROWSER_AGENT_OPEN_BEHAVIORS.includes(input.agentOpenBehavior as BrowserAgentOpenBehavior)
    ? input.agentOpenBehavior as BrowserAgentOpenBehavior
    : DEFAULT_BROWSER_PREFERENCES.agentOpenBehavior;
  const backend = BROWSER_BACKENDS.includes(input.backend as BrowserBackend)
    ? input.backend as BrowserBackend
    : DEFAULT_BROWSER_PREFERENCES.backend;

  return {
    acceptCookies: typeof input.acceptCookies === "boolean"
      ? input.acceptCookies
      : DEFAULT_BROWSER_PREFERENCES.acceptCookies,
    agentOpenBehavior,
    backend,
  };
}

export function mergeBrowserPreferences(current: unknown, patch: unknown): BrowserPreferences {
  const normalizedCurrent = normalizeBrowserPreferences(current);
  const normalizedPatchSource = patch && typeof patch === "object" && !Array.isArray(patch)
    ? patch as Record<string, unknown>
    : {};
  return normalizeBrowserPreferences({
    ...normalizedCurrent,
    ...normalizedPatchSource,
  });
}
