import { describe, expect, it } from 'vitest';
import { errorWithCode, presentError, presentErrorWithLabel } from '../../errors/error-presenter';

const STRINGS: Record<string, string> = {
  'error.code.sessionForkActiveTask': '这条消息之后还有任务在跑，等它结束再从这里分支',
  'error.code.sessionBusy': '会话正忙，稍后再试',
  'error.code.unexpected': '出了点意外',
};

const translate = (key: string): string => STRINGS[key] ?? key;

describe('error-presenter', () => {
  it('speaks the localized sentence and keeps the raw English as detail', () => {
    const error = errorWithCode(
      'active task cannot be shared by a session fork: subagent-1785635522479-v82otz',
      'session_fork_active_task',
    );

    expect(presentError(error, { translate })).toEqual({
      text: '这条消息之后还有任务在跑，等它结束再从这里分支',
      detail: 'active task cannot be shared by a session fork: subagent-1785635522479-v82otz',
      code: 'session_fork_active_task',
    });
  });

  it('falls back to the generic sentence for codes that are not worth their own copy', () => {
    const error = errorWithCode('session pin order is empty', 'session_pin_order_empty');

    expect(presentError(error, { translate })).toEqual({
      text: '出了点意外',
      detail: 'session pin order is empty',
      code: 'session_pin_order_empty',
    });
  });

  it('never renders a raw i18n key when a locale file is missing the entry', () => {
    // translate() echoes the key back when the string is absent; showing that to a
    // user is worse than showing the English sentence the backend already gave us.
    const bare = (key: string): string => key;
    const error = errorWithCode('session is busy right now', 'session_busy');

    expect(presentError(error, { translate: bare })).toEqual({
      text: 'session is busy right now',
      detail: null,
      code: 'session_busy',
    });
  });

  it('handles low-level failures that carry no code at all', () => {
    const error = new Error(
      "/opt/jarvis/server/node_modules/better-sqlite3/build/Release/better_sqlite3.node: "
      + "version `GLIBC_2.29' not found",
    );

    expect(presentError(error, { translate })).toEqual({
      text: '出了点意外',
      detail: expect.stringContaining('GLIBC_2.29'),
      code: null,
    });
  });

  it('accepts plain strings and empty messages without inventing detail', () => {
    expect(presentError('boom', { translate })).toEqual({
      text: '出了点意外',
      detail: 'boom',
      code: null,
    });
    expect(presentError(new Error(''), { translate })).toEqual({
      text: '出了点意外',
      detail: null,
      code: null,
    });
  });

  it('drops the detail when it would merely repeat the localized text', () => {
    const error = errorWithCode('会话正忙，稍后再试', 'session_busy');

    expect(presentError(error, { translate })).toEqual({
      text: '会话正忙，稍后再试',
      detail: null,
      code: 'session_busy',
    });
  });

  it('does not echo the code into detail when the backend message was the code itself', () => {
    const error = errorWithCode('session_busy', 'session_busy');

    expect(presentError(error, { translate })).toEqual({
      text: '会话正忙，稍后再试',
      detail: null,
      code: 'session_busy',
    });
  });

  it('errorWithCode carries the code on a real Error instance', () => {
    const error = errorWithCode('boom', 'session_busy');

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('boom');
    expect(error.code).toBe('session_busy');
    expect(errorWithCode('boom', null).code).toBeUndefined();
  });
});

describe('presentErrorWithLabel', () => {
  it('prefixes the localized action label without touching detail or code', () => {
    const error = errorWithCode('active workflow must finish before Fork', 'session_fork_active_task');

    expect(presentErrorWithLabel('新建会话失败', error, { translate })).toEqual({
      text: '新建会话失败: 这条消息之后还有任务在跑，等它结束再从这里分支',
      detail: 'active workflow must finish before Fork',
      code: 'session_fork_active_task',
    });
  });

  it('keeps a native crash readable while parking the stack in detail', () => {
    // The server process failing to load its native addon has no error code at all.
    const error = new Error(
      "/opt/jarvis/server/node_modules/better-sqlite3/build/Release/"
      + "better_sqlite3.node: version `GLIBC_2.29' not found",
    );

    const presented = presentErrorWithLabel('新建会话失败', error, { translate });

    expect(presented.text).toBe('新建会话失败: 出了点意外');
    expect(presented.detail).toContain('GLIBC_2.29');
    expect(presented.code).toBeNull();
  });

  it('skips the separator when there is no label', () => {
    expect(presentErrorWithLabel('', 'boom', { translate }).text).toBe('出了点意外');
  });
});
