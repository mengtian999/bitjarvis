/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { ProviderSummary } from '../../settings/store';

const mocks = vi.hoisted(() => ({
  jarvisFetch: vi.fn(),
}));

vi.mock('../../settings/api', () => ({
  jarvisFetch: (...args: unknown[]) => mocks.jarvisFetch(...args),
}));

vi.mock('../../settings/helpers', () => ({
  t: (key: string) => key,
}));

import { OAuthCredentials } from '../../settings/tabs/providers/OAuthCredentials';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

const summary: ProviderSummary = {
  type: 'oauth',
  auth_type: 'oauth',
  display_name: 'ChatGPT Plus/Pro',
  base_url: '',
  api: 'openai-responses',
  api_key: '',
  models: [],
  custom_models: [],
  has_credentials: false,
  logged_in: false,
  supports_oauth: true,
  can_delete: false,
};

describe('OAuthCredentials', () => {
  beforeEach(() => {
    mocks.jarvisFetch.mockReset();
    mocks.jarvisFetch.mockResolvedValue(jsonResponse({
      sessionId: 'oauth-session-1',
      url: 'https://auth.example/start',
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it('requests the explicit browser login method and keeps the callback session local', async () => {
    const onRefresh = vi.fn(async () => {});
    render(
      <OAuthCredentials
        providerId="openai-codex-oauth"
        summary={summary}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'settings.oauth.login' }));

    await waitFor(() => expect(mocks.jarvisFetch).toHaveBeenCalledTimes(1));
    const [startPath, startOptions] = mocks.jarvisFetch.mock.calls[0];
    expect(startPath).toBe('/api/auth/oauth/start');
    expect(JSON.parse(String((startOptions as RequestInit).body))).toEqual({
      provider: 'openai-codex-oauth',
      loginMethod: 'browser',
    });

    mocks.jarvisFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'manual-code' } });
    fireEvent.click(screen.getByRole('button', { name: 'settings.oauth.submit' }));

    await waitFor(() => expect(mocks.jarvisFetch).toHaveBeenCalledTimes(2));
    const [callbackPath, callbackOptions] = mocks.jarvisFetch.mock.calls[1];
    expect(callbackPath).toBe('/api/auth/oauth/callback');
    expect(JSON.parse(String((callbackOptions as RequestInit).body))).toEqual({
      sessionId: 'oauth-session-1',
      code: 'manual-code',
    });
  });
});
