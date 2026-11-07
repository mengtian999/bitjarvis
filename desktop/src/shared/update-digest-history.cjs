/**
 * Settings > About update history.
 *
 * GitHub Releases is the release source of truth. The installed v2 anthology
 * plays two roles: it fills the permanent gaps of the online scan (releases
 * whose tags predate the `vX.Y.Z` pattern can never be discovered online)
 * beneath the online entries, and it is the explicit offline fallback when
 * the network is unreachable, because older app packages cannot contain
 * releases published after they were built.
 */

const DEFAULT_RELEASES_API = "https://api.github.com/repos/mengtian999/Bitjarvis/releases?per_page=20&page=1";
const DEFAULT_RELEASE_ASSET_BASE = "https://github.com/mengtian999/Bitjarvis/releases/download";
const DIGEST_ASSET_NAME = "release-digest.v1.json";
const HISTORY_LIMIT = 5;
const RELEASE_SCAN_LIMIT = 10;
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RELEASES_BODY_CHARS = 512 * 1024;
const MAX_DIGEST_BODY_CHARS = 128 * 1024;

function versionFromTag(tag) {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(String(tag || "").trim());
  return match ? match[1] : null;
}

function compareVersionDesc(a, b) {
  const pa = String(a || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = String(b || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Online entries win, bundled entries fill the permanent gaps (older
 * releases whose tags don't match the `vX.Y.Z` scan pattern — e.g. the
 * pre-rename v0.0.1 tag — can never be discovered online), then newest
 * first, capped at HISTORY_LIMIT.
 */
function mergeWithBundled(onlineEntries, bundledEntries) {
  const seen = new Set(onlineEntries.map((entry) => entry && entry.version).filter(Boolean));
  const merged = [...onlineEntries];
  for (const entry of Array.isArray(bundledEntries) ? bundledEntries : []) {
    if (!entry || typeof entry.version !== "string" || seen.has(entry.version)) continue;
    seen.add(entry.version);
    merged.push(entry);
  }
  merged.sort((a, b) => compareVersionDesc(a.version, b.version));
  return merged.slice(0, HISTORY_LIMIT);
}

function hasDigestAsset(release) {
  return Array.isArray(release?.assets)
    && release.assets.some((asset) => asset?.name === DIGEST_ASSET_NAME);
}

function digestUrl(tag) {
  return `${DEFAULT_RELEASE_ASSET_BASE}/${encodeURIComponent(tag)}/${DIGEST_ASSET_NAME}`;
}

async function fetchJson(fetchImpl, url, { maxChars, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Jarvis-update-history",
      },
      signal: controller.signal,
    });
    if (!response?.ok) {
      throw new Error(`request failed (${response?.status || "unknown"}) for ${url}`);
    }
    const text = await response.text();
    if (text.length > maxChars) {
      throw new Error(`response too large for ${url}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function loadOnlineEntries({ fetchImpl, normalize, timeoutMs }) {
  const releases = await fetchJson(fetchImpl, DEFAULT_RELEASES_API, {
    maxChars: MAX_RELEASES_BODY_CHARS,
    timeoutMs,
  });
  if (!Array.isArray(releases)) {
    throw new Error("GitHub releases response is not an array");
  }

  const candidates = releases
    .filter((release) => release && release.draft === false)
    .filter((release) => versionFromTag(release.tag_name) && hasDigestAsset(release))
    .slice(0, RELEASE_SCAN_LIMIT);

  const settled = await Promise.all(candidates.map(async (release) => {
    const version = versionFromTag(release.tag_name);
    if (!version) return null;
    try {
      const payload = await fetchJson(fetchImpl, digestUrl(release.tag_name), {
        maxChars: MAX_DIGEST_BODY_CHARS,
        timeoutMs,
      });
      return normalize(payload, version);
    } catch {
      return null;
    }
  }));

  return settled.filter(Boolean).slice(0, HISTORY_LIMIT);
}

function createUpdateDigestHistoryLoader({
  fetchImpl = globalThis.fetch,
  normalize,
  readBundledEntries,
  log = () => {},
  now = () => Date.now(),
  cacheTtlMs = CACHE_TTL_MS,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (typeof normalize !== "function") throw new TypeError("normalize must be a function");
  if (typeof readBundledEntries !== "function") throw new TypeError("readBundledEntries must be a function");

  let cached = null;
  let inFlight = null;

  return async function loadUpdateDigestHistory() {
    const currentTime = now();
    if (cached && currentTime - cached.storedAt < cacheTtlMs) return cached.result;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const entries = await loadOnlineEntries({ fetchImpl, normalize, timeoutMs });
        if (entries.length === 0) throw new Error("no valid release digests found");
        const result = {
          entries: mergeWithBundled(entries, readBundledEntries()),
          source: "online",
          complete: entries.length === HISTORY_LIMIT,
        };
        cached = { result, storedAt: now() };
        return result;
      } catch (error) {
        log(`update history online load failed: ${error?.message || String(error)}`);
        const entries = readBundledEntries().slice(0, HISTORY_LIMIT);
        return {
          entries,
          source: entries.length > 0 ? "bundled" : "none",
          complete: false,
        };
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  };
}

module.exports = {
  createUpdateDigestHistoryLoader,
  versionFromTag,
};
