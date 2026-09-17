/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mocks = vi.hoisted(() => ({
  jarvisFetch: vi.fn(),
  invalidateConfigCache: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../settings/api', () => ({
  jarvisFetch: (...args: unknown[]) => mocks.jarvisFetch(...args),
}));

vi.mock('../../../hooks/use-config', () => ({
  invalidateConfigCache: () => mocks.invalidateConfigCache(),
}));

vi.mock('../../settings/store', () => ({
  useSettingsStore: (selector: (state: { showToast: typeof mocks.showToast }) => unknown) =>
    selector({ showToast: mocks.showToast }),
}));

vi.mock('../../settings/helpers', () => ({
  t: (key: string) => key,
}));

vi.mock('../../settings/hooks/useAnchoredDropdown', () => ({
  useAnchoredDropdown: () => ({ position: 'fixed', left: 0, top: 0, width: 280 }),
}));

vi.mock('@/ui', () => ({
  SelectWidget: ({ value, onChange, options }: {
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

import { MediaProviderDetail } from '../../settings/tabs/media/MediaProviderDetail';

describe('MediaProviderDetail', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('allows adding a custom image model id when provider discovery has no candidate list', async () => {
    mocks.jarvisFetch.mockResolvedValue({ json: async () => ({ ok: true }) });
    const onRefresh = vi.fn(async () => {});

    render(
      <MediaProviderDetail
        providerId="dashscope"
        provider={{
          displayName: 'DashScope',
          hasCredentials: true,
          models: [],
          availableModels: [],
        }}
        config={{}}
        onSaveConfig={vi.fn(async () => {})}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /settings\.media\.addModel/ }));
    fireEvent.change(screen.getByPlaceholderText('settings.api.searchModel'), {
      target: { value: 'qwen-image-2.0-pro' },
    });
    fireEvent.click(screen.getByRole('button', { name: /qwen-image-2\.0-pro/ }));

    await waitFor(() => {
      expect(mocks.jarvisFetch).toHaveBeenCalledWith('/api/media/image/providers/dashscope/models', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ model: { id: 'qwen-image-2.0-pro' } }),
      }));
    });
    expect(onRefresh).toHaveBeenCalled();
  });

  it('shows runtime discovery failures and keeps CLI-owned model controls read-only', () => {
    render(
      <MediaProviderDetail
        providerId="jimeng-cli"
        provider={{
          displayName: '即梦 CLI',
          hasCredentials: false,
          unavailableReason: 'output_unparseable',
          unavailableMessage: 'Dreamina CLI help changed and could not be parsed',
          runtimeCapability: {
            status: 'error',
            error: {
              code: 'output_unparseable',
              message: 'Dreamina CLI help changed and could not be parsed',
            },
          },
          models: [],
          availableModels: [],
        }}
        config={{}}
        onSaveConfig={vi.fn(async () => {})}
        onRefresh={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByText('Dreamina CLI help changed and could not be parsed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /settings\.media\.addModel/ })).not.toBeInTheDocument();
  });

  it('does not offer remove controls for models discovered from a CLI', () => {
    render(
      <MediaProviderDetail
        providerId="jimeng-cli"
        provider={{
          displayName: '即梦 CLI',
          hasCredentials: true,
          runtimeCapability: { status: 'ready' },
          models: [{ id: 'jimeng-image-5.0', name: '即梦图片 5.0' }],
          availableModels: [],
        }}
        config={{}}
        onSaveConfig={vi.fn(async () => {})}
        onRefresh={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByText('jimeng-image-5.0')).toBeInTheDocument();
    expect(screen.queryByTitle('settings.api.removeModel')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /settings\.media\.addModel/ })).not.toBeInTheDocument();
  });
});
