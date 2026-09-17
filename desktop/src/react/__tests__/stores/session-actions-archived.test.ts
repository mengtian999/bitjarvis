import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../hooks/use-jarvis-fetch', () => ({
  jarvisFetch: vi.fn(),
  jarvisUrl: (p: string) => p,
}));

vi.mock('../../stores', () => ({
  useStore: {
    getState: () => ({ setSessionMetaRecovery: vi.fn() }),
    setState: vi.fn(),
  },
}));

import { jarvisFetch } from '../../hooks/use-jarvis-fetch';

const jarvisFetchMock = jarvisFetch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  jarvisFetchMock.mockReset();
});

describe('archived-session actions', () => {
  it('listArchivedSessions returns the body array', async () => {
    jarvisFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ path: '/x/a.jsonl', title: 'Hi' }],
    });
    const { listArchivedSessions } = await import('../../stores/session-actions');
    const list = await listArchivedSessions();
    expect(list.length).toBe(1);
    expect(list[0].title).toBe('Hi');
    expect(jarvisFetchMock).toHaveBeenCalledWith('/api/sessions/archived');
  });

  it('listArchivedSessions returns [] when fetch not ok', async () => {
    jarvisFetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'x' }) });
    const { listArchivedSessions } = await import('../../stores/session-actions');
    expect(await listArchivedSessions()).toEqual([]);
  });

  it("restoreSession returns structured ok on 200 and posts sessionId when available", async () => {
    jarvisFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, restoredPath: '/x/restored.jsonl', sessionId: 'sess_archived' }),
    });
    jarvisFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ([]),
    });
    const { restoreSession } = await import('../../stores/session-actions');
    await expect(restoreSession({ path: '/x/a.jsonl', sessionId: 'sess_archived' })).resolves.toEqual({
      status: 'ok',
      restoredPath: '/x/restored.jsonl',
      sessionId: 'sess_archived',
    });
    expect(jarvisFetchMock).toHaveBeenCalledWith(
      '/api/sessions/restore',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/x/a.jsonl', sessionId: 'sess_archived' }),
      }),
    );
  });

  it("restoreSession returns conflict on 409", async () => {
    jarvisFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'conflict' }),
    });
    const { restoreSession } = await import('../../stores/session-actions');
    await expect(restoreSession('/x/a.jsonl')).resolves.toEqual({
      status: 'conflict',
      error: 'conflict',
    });
  });

  it("restoreSession returns error on 500", async () => {
    jarvisFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    });
    const { restoreSession } = await import('../../stores/session-actions');
    await expect(restoreSession('/x/a.jsonl')).resolves.toEqual({
      status: 'error',
      error: 'boom',
    });
  });

  it('deleteArchivedSession posts path/sessionId and returns true on ok', async () => {
    jarvisFetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    const { deleteArchivedSession } = await import('../../stores/session-actions');
    const r = await deleteArchivedSession({ path: '/x/a.jsonl', sessionId: 'sess_delete_archived' });
    expect(r).toBe(true);
    expect(jarvisFetchMock).toHaveBeenCalledWith(
      '/api/sessions/archived/delete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/x/a.jsonl', sessionId: 'sess_delete_archived' }),
      }),
    );
  });

  it('deleteArchivedSession returns false when not ok', async () => {
    jarvisFetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'x' }) });
    const { deleteArchivedSession } = await import('../../stores/session-actions');
    expect(await deleteArchivedSession('/x/a.jsonl')).toBe(false);
  });

  it('cleanupArchivedSessions posts maxAgeDays and parses deleted', async () => {
    jarvisFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, deleted: 5 }),
    });
    const { cleanupArchivedSessions } = await import('../../stores/session-actions');
    const r = await cleanupArchivedSessions(30);
    expect(r.deleted).toBe(5);
    expect(jarvisFetchMock).toHaveBeenCalledWith(
      '/api/sessions/cleanup',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
