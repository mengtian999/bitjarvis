import { describe, expect, it } from 'vitest';
import {
  ERROR_CODE_MESSAGE_KEYS,
  UNKNOWN_ERROR_MESSAGE_KEY,
  errorCodeFromResponseBody,
  userMessageKeyForCode,
} from '../../../../../shared/error-user-messages.ts';
import en from '../../../locales/en.json';
import ja from '../../../locales/ja.json';
import ko from '../../../locales/ko.json';
import zh from '../../../locales/zh.json';
import zhTW from '../../../locales/zh-TW.json';

const LOCALES: Record<string, unknown> = { en, ja, ko, zh, 'zh-TW': zhTW };

function lookup(locale: unknown, dotPath: string): unknown {
  return dotPath.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    locale,
  );
}

describe('error-user-messages · code → i18n key', () => {
  it('maps the high-frequency session codes users actually hit', () => {
    expect(userMessageKeyForCode('session_fork_active_task')).toBe('error.code.sessionForkActiveTask');
    expect(userMessageKeyForCode('session_busy')).toBe('error.code.sessionBusy');
    expect(userMessageKeyForCode('subagent_run_busy')).toBe('error.code.subagentRunBusy');
  });

  it('returns null for unmapped codes so callers fall back explicitly', () => {
    expect(userMessageKeyForCode('some_internal_code_nobody_shows')).toBeNull();
    expect(userMessageKeyForCode('')).toBeNull();
    expect(userMessageKeyForCode(null)).toBeNull();
    expect(userMessageKeyForCode(42)).toBeNull();
  });

  it('keeps every mapped key under the error.code namespace', () => {
    for (const [code, key] of Object.entries(ERROR_CODE_MESSAGE_KEYS)) {
      expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(key).toMatch(/^error\.code\.[A-Za-z]+$/);
    }
  });

  it('exposes a dedicated fallback key that is not one of the mapped codes', () => {
    expect(UNKNOWN_ERROR_MESSAGE_KEY).toBe('error.code.unexpected');
    expect(Object.values(ERROR_CODE_MESSAGE_KEYS)).not.toContain(UNKNOWN_ERROR_MESSAGE_KEY);
  });
});

describe('error-user-messages · locale coverage', () => {
  const keys = [...Object.values(ERROR_CODE_MESSAGE_KEYS), UNKNOWN_ERROR_MESSAGE_KEY];

  it.each(Object.keys(LOCALES))('%s carries copy for every mapped error code', (name) => {
    // A key with no copy makes t() echo the key back, and presentError then falls
    // back to raw English. Mapping a code without writing its copy is a silent
    // regression, so fail here instead.
    const missing = keys.filter((key) => typeof lookup(LOCALES[name], key) !== 'string');
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(LOCALES))('%s leaves no error-code copy blank', (name) => {
    const blank = keys.filter((key) => String(lookup(LOCALES[name], key) ?? '').trim() === '');
    expect(blank).toEqual([]);
  });
});

describe('error-user-messages · response body normalization', () => {
  it('prefers the explicit code field', () => {
    expect(errorCodeFromResponseBody({ error: 'active task blocks fork', code: 'session_fork_active_task' }))
      .toBe('session_fork_active_task');
  });

  it('accepts routes whose error field is the code itself', () => {
    // GET /sessions/fork answers a busy session with { error: "session_busy" } and no code field.
    expect(errorCodeFromResponseBody({ error: 'session_busy' })).toBe('session_busy');
  });

  it('never mistakes a human sentence for a code', () => {
    expect(errorCodeFromResponseBody({ error: 'session not found' })).toBeNull();
    expect(errorCodeFromResponseBody({ error: 'Invalid session path' })).toBeNull();
    expect(errorCodeFromResponseBody({ error: 'GLIBC_2.29 not found' })).toBeNull();
  });

  it('tolerates missing or malformed bodies', () => {
    expect(errorCodeFromResponseBody(null)).toBeNull();
    expect(errorCodeFromResponseBody(undefined)).toBeNull();
    expect(errorCodeFromResponseBody({})).toBeNull();
    expect(errorCodeFromResponseBody('boom')).toBeNull();
    expect(errorCodeFromResponseBody({ code: '   ' })).toBeNull();
  });
});
