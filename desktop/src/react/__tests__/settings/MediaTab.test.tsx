/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mocks = vi.hoisted(() => ({
  jarvisFetch: vi.fn(),
}));

vi.mock('../../settings/api', () => ({
  jarvisFetch: (...args: unknown[]) => mocks.jarvisFetch(...args),
}));

vi.mock('../../settings/helpers', () => ({
  t: (key: string) => key,
}));

vi.mock('../../settings/components/SettingsSection', () => ({
  SettingsSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));

vi.mock('../../settings/components/SettingsRow', () => ({
  SettingsRow: ({ label, control }: { label: string; control: React.ReactNode }) => (
    <label>
      <span>{label}</span>
      {control}
    </label>
  ),
}));

vi.mock('../../settings/tabs/media/MediaProviderDetail', () => ({
  MediaProviderDetail: ({ providerId, capability = 'imageGeneration' }: { providerId: string; capability?: string }) => (
    <div data-testid="media-provider-detail">{capability === 'videoGeneration' ? 'video' : 'image'}:{providerId}</div>
  ),
}));

vi.mock('@/ui', () => ({
  Toggle: ({
    on,
    onChange,
    label,
    ariaLabel,
  }: {
    on: boolean | undefined;
    onChange: (next: boolean) => void;
    label?: string;
    ariaLabel?: string;
  }) => (
    <button
      type="button"
      role="switch"
      aria-label={ariaLabel || label}
      aria-checked={on === undefined ? 'mixed' : on}
      disabled={on === undefined}
      onClick={() => {
        if (on !== undefined) onChange(!on);
      }}
    />
  ),
  SelectWidget: ({ value, onChange, options, disabled }: {
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string; disabled?: boolean }>;
    disabled?: boolean;
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map(option => (
        <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
      ))}
    </select>
  ),
}));

import { MediaTab } from '../../settings/tabs/MediaTab';
import { useSettingsStore } from '../../settings/store';

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

describe('MediaTab media config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jarvisFetch.mockImplementation((path: string) => {
      if (path === '/api/media/image/providers') {
        return Promise.resolve(jsonResponse({
          providers: {
            volcengine: {
              providerId: 'volcengine',
              displayName: 'Volcengine',
              hasCredentials: true,
              models: [{ id: 'seedream-5', name: 'Seedream 5.0' }],
              availableModels: [],
            },
          },
          config: {},
        }));
      }
      if (path === '/api/media/video/providers') {
        return Promise.resolve(jsonResponse({ providers: {}, config: {} }));
      }
      return Promise.resolve(jsonResponse({ values: { defaultImageModel: { provider: 'volcengine', id: 'seedream-5' } } }));
    });
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState({
      settingsSnapshot: {
        key: null,
        status: 'idle',
        data: null,
        error: null,
        requestId: 0,
        updatedAt: null,
      },
      mediaCache: {},
    });
  });

  it('keeps default model selectors in loading state until provider configs arrive', async () => {
    let resolveImageProviders: (response: Response) => void = () => {};
    let resolveSpeechProviders: (response: Response) => void = () => {};
    mocks.jarvisFetch.mockImplementation((path: string) => {
      if (path === '/api/media/image/providers') {
        return new Promise(resolve => {
          resolveImageProviders = resolve;
        });
      }
      if (path === '/api/speech-recognition/providers') {
        return new Promise(resolve => {
          resolveSpeechProviders = resolve;
        });
      }
      return Promise.resolve(jsonResponse({ values: {} }));
    });

    render(<MediaTab />);

    const imageSelect = screen.getByLabelText('settings.media.defaultModel') as HTMLSelectElement;
    const speechSelect = screen.getByLabelText('语音条转录模型') as HTMLSelectElement;
    expect(imageSelect.disabled).toBe(true);
    expect(imageSelect.value).toBe('__loading');
    expect(speechSelect.disabled).toBe(true);
    expect(speechSelect.value).toBe('__loading');

    resolveImageProviders(jsonResponse({
      providers: {
        volcengine: {
          providerId: 'volcengine',
          displayName: 'Volcengine',
          hasCredentials: true,
          models: [{ id: 'seedream-5', name: 'Seedream 5.0' }],
          availableModels: [],
        },
      },
      config: { defaultImageModel: { provider: 'volcengine', id: 'seedream-5' } },
    }));
    resolveSpeechProviders(jsonResponse({
      providers: {
        openai: {
          providerId: 'openai',
          displayName: 'OpenAI Speech',
          hasCredentials: true,
          models: [{ id: 'whisper-1', name: 'Whisper 1', adapterAvailable: true }],
        },
      },
      config: { enabled: true, defaultModel: { provider: 'openai', id: 'whisper-1' } },
    }));

    await waitFor(() => {
      expect(imageSelect.value).toBe('volcengine/seedream-5');
      expect(speechSelect.value).toBe('openai/whisper-1');
    });
  });

  it('loads global media config without agent scope and saves through the generic config envelope', async () => {
    render(<MediaTab />);

    const select = await screen.findByLabelText('settings.media.defaultModel');
    await waitFor(() => {
      expect(mocks.jarvisFetch).toHaveBeenCalledWith('/api/media/image/providers');
    });

    fireEvent.change(select, { target: { value: 'volcengine/seedream-5' } });

    await waitFor(() => {
      expect(mocks.jarvisFetch.mock.calls.some(([path]) => path === '/api/media/image/config')).toBe(true);
    });
    const saveCall = mocks.jarvisFetch.mock.calls.find(([path]) => path === '/api/media/image/config');
    expect(saveCall?.[1]).toMatchObject({ method: 'PUT' });
    expect(JSON.parse(String((saveCall?.[1] as RequestInit).body))).toEqual({
      values: {
        defaultImageModel: { provider: 'volcengine', id: 'seedream-5' },
      },
    });
    expect(mocks.jarvisFetch.mock.calls.map(call => String(call[0])).join('\n')).not.toContain('agentId=');
  });

  it('sends null to clear the global default model over HTTP', async () => {
    mocks.jarvisFetch.mockImplementation((path: string) => {
      if (path === '/api/media/image/providers') {
        return Promise.resolve(jsonResponse({
          providers: {
            volcengine: {
              providerId: 'volcengine',
              displayName: 'Volcengine',
              hasCredentials: true,
              models: [{ id: 'seedream-5', name: 'Seedream 5.0' }],
              availableModels: [],
            },
          },
          config: { defaultImageModel: { provider: 'volcengine', id: 'seedream-5' } },
        }));
      }
      return Promise.resolve(jsonResponse({ values: {} }));
    });

    render(<MediaTab />);

    const select = await screen.findByLabelText('settings.media.defaultModel');
    fireEvent.change(select, { target: { value: '' } });

    await waitFor(() => {
      expect(mocks.jarvisFetch).toHaveBeenCalledWith('/api/media/image/config', expect.objectContaining({
        body: JSON.stringify({ values: { defaultImageModel: null } }),
      }));
    });
  });

  it('auto-selects the first credentialed image provider instead of the first provider in transport order', async () => {
    mocks.jarvisFetch.mockImplementation((path: string) => {
      if (path === '/api/media/image/providers') {
        return Promise.resolve(jsonResponse({
          providers: {
            openai: {
              providerId: 'openai',
              displayName: 'OpenAI',
              hasCredentials: false,
              models: [{ id: 'gpt-image-2', name: 'GPT Image 2' }],
              availableModels: [],
            },
            volcengine: {
              providerId: 'volcengine',
              displayName: 'Volcengine',
              hasCredentials: true,
              models: [{ id: 'seedream-5', name: 'Seedream 5.0' }],
              availableModels: [],
            },
          },
          config: {},
        }));
      }
      return Promise.resolve(jsonResponse({ values: {} }));
    });

    render(<MediaTab />);

    expect(await screen.findByTestId('media-provider-detail')).toHaveTextContent('image:volcengine');
  });

  it('switches the detail pane to speech recognition providers without falling back to image provider details', async () => {
    mocks.jarvisFetch.mockImplementation((path: string) => {
      if (path === '/api/media/image/providers') {
        return Promise.resolve(jsonResponse({
          providers: {
            dashscope: {
              providerId: 'dashscope',
              displayName: 'DashScope Images',
              hasCredentials: true,
              models: [{ id: 'qwen-image', name: 'Qwen Image' }],
              availableModels: [],
            },
          },
          config: {},
        }));
      }
      if (path === '/api/speech-recognition/providers') {
        return Promise.resolve(jsonResponse({
          providers: {
            dashscope: {
              providerId: 'dashscope',
              displayName: 'DashScope Speech',
              hasCredentials: true,
              models: [{ id: 'qwen3-asr-flash', name: 'Qwen ASR Flash', adapterAvailable: true }],
              availableModels: [{ id: 'qwen3-asr-flash', name: 'Qwen ASR Flash' }],
            },
          },
          config: { enabled: true, defaultModel: { provider: 'dashscope', id: 'qwen3-asr-flash' } },
        }));
      }
      return Promise.resolve(jsonResponse({ values: {} }));
    });

    render(<MediaTab />);

    expect(await screen.findByTestId('media-provider-detail')).toHaveTextContent('image:dashscope');
    fireEvent.click(await screen.findByRole('button', { name: /DashScope Speech/ }));

    expect(screen.queryByTestId('media-provider-detail')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'DashScope Speech' })).toBeInTheDocument();
    expect(screen.getByText('Qwen ASR Flash')).toBeInTheDocument();
    expect(screen.getByText('qwen3-asr-flash')).toBeInTheDocument();
  });

  it('does not offer image models with missing runtime adapters as selectable defaults', async () => {
    mocks.jarvisFetch.mockImplementation((path: string) => {
      if (path === '/api/media/image/providers') {
        return Promise.resolve(jsonResponse({
          providers: {
            axis: {
              providerId: 'axis',
              displayName: 'Axis',
              hasCredentials: true,
              models: [{ id: 'gpt-image-2', name: 'GPT Image 2', protocolId: 'axis-images', adapterAvailable: false }],
              availableModels: [],
            },
          },
          config: {},
        }));
      }
      return Promise.resolve(jsonResponse({ values: {} }));
    });

    render(<MediaTab />);

    const select = await screen.findByLabelText('settings.media.defaultModel');
    const option = Array.from(select.querySelectorAll('option')).find((item) => item.value === 'axis/gpt-image-2');
    expect(option).toBeTruthy();
    expect(option).toBeDisabled();
    expect(option?.textContent).toContain('settings.media.adapterMissing');
  });

  it('surfaces runtime CLI discovery errors on provider and model choices', async () => {
    mocks.jarvisFetch.mockImplementation((path: string) => {
      if (path === '/api/media/image/providers') {
        return Promise.resolve(jsonResponse({
          providers: {
            'jimeng-cli': {
              providerId: 'jimeng-cli',
              displayName: '即梦 CLI',
              hasCredentials: false,
              unavailableReason: 'output_unparseable',
              unavailableMessage: 'Dreamina CLI help changed',
              runtimeCapability: { status: 'stale' },
              models: [{ id: 'jimeng-image-5.0', name: '即梦图片 5.0', adapterAvailable: true }],
              availableModels: [],
            },
          },
          config: {},
        }));
      }
      return Promise.resolve(jsonResponse({ values: {} }));
    });

    render(<MediaTab />);

    const providerButton = await screen.findByRole('button', { name: /即梦 CLI/ });
    expect(providerButton).toHaveAttribute('title', 'Dreamina CLI help changed');
    const select = await screen.findByLabelText('settings.media.defaultModel');
    const option = Array.from(select.querySelectorAll('option'))
      .find((item) => item.value === 'jimeng-cli/jimeng-image-5.0');
    expect(option).toBeDisabled();
    expect(option?.textContent).toContain('Dreamina CLI help changed');
  });

  it('refreshes runtime CLI model choices when the app regains focus', async () => {
    let imageLoads = 0;
    mocks.jarvisFetch.mockImplementation((path: string) => {
      if (path === '/api/media/image/providers') {
        imageLoads += 1;
        const modelId = imageLoads === 1 ? 'jimeng-image-4.7' : 'jimeng-image-5.0';
        return Promise.resolve(jsonResponse({
          providers: {
            'jimeng-cli': {
              providerId: 'jimeng-cli',
              displayName: '即梦 CLI',
              hasCredentials: true,
              runtimeCapability: { status: 'ready' },
              models: [{ id: modelId, name: modelId, adapterAvailable: true }],
              availableModels: [],
            },
          },
          config: {},
        }));
      }
      return Promise.resolve(jsonResponse({ providers: {}, config: {} }));
    });

    render(<MediaTab />);

    const select = await screen.findByLabelText('settings.media.defaultModel');
    await waitFor(() => {
      expect(Array.from(select.querySelectorAll('option')).some(option => option.value.endsWith('/jimeng-image-4.7'))).toBe(true);
    });

    window.dispatchEvent(new Event('focus'));

    await waitFor(() => {
      expect(Array.from(select.querySelectorAll('option')).some(option => option.value.endsWith('/jimeng-image-5.0'))).toBe(true);
    });
    expect(imageLoads).toBeGreaterThanOrEqual(2);
  });

  it('renders custom provider image models from the endpoint and offers them as selectable defaults (#1627)', async () => {
    mocks.jarvisFetch.mockImplementation((path: string) => {
      if (path === '/api/media/image/providers') {
        return Promise.resolve(jsonResponse({
          providers: {
            'my-proxy': {
              providerId: 'my-proxy',
              displayName: 'My Proxy',
              hasCredentials: true,
              models: [{ id: 'flux-1.1-pro', name: 'FLUX 1.1 Pro', protocolId: 'openai-images', adapterAvailable: true }],
              availableModels: [],
            },
          },
          config: {},
        }));
      }
      return Promise.resolve(jsonResponse({ values: {} }));
    });

    render(<MediaTab />);

    // 自定义 provider 出现在左侧 provider 列表
    expect(await screen.findByText('My Proxy')).toBeInTheDocument();
    // 详情面板选中该 provider
    expect(screen.getByTestId('media-provider-detail')).toHaveTextContent('image:my-proxy');
    // 其图片模型出现在全局默认模型选择器中且可选
    const select = await screen.findByLabelText('settings.media.defaultModel');
    const option = Array.from(select.querySelectorAll('option')).find((item) => item.value === 'my-proxy/flux-1.1-pro');
    expect(option).toBeTruthy();
    expect(option).not.toBeDisabled();
    expect(option?.textContent).toContain('FLUX 1.1 Pro');
  });

  it('loads speech-recognition providers from the speech endpoint', async () => {
    mocks.jarvisFetch.mockImplementation((path: string) => {
      if (path === '/api/media/image/providers') {
        return Promise.resolve(jsonResponse({ providers: {}, config: {} }));
      }
      if (path === '/api/speech-recognition/providers') {
        return Promise.resolve(jsonResponse({
          providers: {
            openai: {
              providerId: 'openai',
              displayName: 'OpenAI Speech',
              hasCredentials: true,
              models: [{ id: 'whisper-1', name: 'Whisper 1', adapterAvailable: true }],
            },
          },
          config: { enabled: false },
        }));
      }
      return Promise.resolve(jsonResponse({ values: {} }));
    });

    render(<MediaTab />);

    expect(await screen.findByText('OpenAI Speech')).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.jarvisFetch).toHaveBeenCalledWith('/api/speech-recognition/providers');
    });
  });

  it('loads video generation providers and saves the default video model through the video config endpoint', async () => {
    mocks.jarvisFetch.mockImplementation((path: string) => {
      if (path === '/api/media/image/providers') {
        return Promise.resolve(jsonResponse({ providers: {}, config: {} }));
      }
      if (path === '/api/media/video/providers') {
        return Promise.resolve(jsonResponse({
          providers: {
            agnes: {
              providerId: 'agnes',
              displayName: 'Agnes AI',
              hasCredentials: true,
              models: [{ id: 'agnes-video-v2.0', name: 'Agnes Video V2.0', protocolId: 'agnes-videos', adapterAvailable: true }],
              availableModels: [],
            },
          },
          config: {},
        }));
      }
      if (path === '/api/speech-recognition/providers') {
        return Promise.resolve(jsonResponse({ providers: {}, config: { enabled: false } }));
      }
      if (path === '/api/media/video/config') {
        return Promise.resolve(jsonResponse({
          values: { defaultVideoModel: { provider: 'agnes', id: 'agnes-video-v2.0' } },
        }));
      }
      return Promise.resolve(jsonResponse({ values: {} }));
    });

    render(<MediaTab />);

    expect(await screen.findByText('Agnes AI')).toBeInTheDocument();
    expect(screen.getByTestId('media-provider-detail')).toHaveTextContent('video:agnes');

    const select = await screen.findByLabelText('settings.media.defaultVideoModel');
    fireEvent.change(select, { target: { value: 'agnes/agnes-video-v2.0' } });

    await waitFor(() => {
      expect(mocks.jarvisFetch).toHaveBeenCalledWith('/api/media/video/config', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ values: { defaultVideoModel: { provider: 'agnes', id: 'agnes-video-v2.0' } } }),
      }));
    });
  });

  it('saves speech-recognition enabled state through the speech config endpoint', async () => {
    mocks.jarvisFetch.mockImplementation((path: string) => {
      if (path === '/api/media/image/providers') {
        return Promise.resolve(jsonResponse({ providers: {}, config: {} }));
      }
      if (path === '/api/speech-recognition/providers') {
        return Promise.resolve(jsonResponse({
          providers: {
            openai: {
              providerId: 'openai',
              displayName: 'OpenAI Speech',
              hasCredentials: true,
              models: [{ id: 'whisper-1', name: 'Whisper 1', adapterAvailable: true }],
            },
          },
          config: { enabled: false },
        }));
      }
      if (path === '/api/speech-recognition/config') {
        return Promise.resolve(jsonResponse({ ok: true, config: { enabled: true } }));
      }
      return Promise.resolve(jsonResponse({ values: {} }));
    });

    render(<MediaTab />);

    const toggle = await screen.findByRole('switch', { name: '发送语音条时转录' });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.jarvisFetch).toHaveBeenCalledWith('/api/speech-recognition/config', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ values: { enabled: true } }),
      }));
    });
  });

  it('saves the default speech-recognition model through the speech config endpoint', async () => {
    mocks.jarvisFetch.mockImplementation((path: string) => {
      if (path === '/api/media/image/providers') {
        return Promise.resolve(jsonResponse({ providers: {}, config: {} }));
      }
      if (path === '/api/speech-recognition/providers') {
        return Promise.resolve(jsonResponse({
          providers: {
            openai: {
              providerId: 'openai',
              displayName: 'OpenAI Speech',
              hasCredentials: true,
              models: [{ id: 'whisper-1', name: 'Whisper 1', adapterAvailable: true }],
            },
          },
          config: { enabled: true },
        }));
      }
      if (path === '/api/speech-recognition/config') {
        return Promise.resolve(jsonResponse({
          values: { enabled: true, defaultModel: { provider: 'openai', id: 'whisper-1' } },
        }));
      }
      return Promise.resolve(jsonResponse({ values: {} }));
    });

    render(<MediaTab />);

    const select = await screen.findByLabelText('语音条转录模型');
    fireEvent.change(select, { target: { value: 'openai/whisper-1' } });

    await waitFor(() => {
      expect(mocks.jarvisFetch.mock.calls.some(([path]) => path === '/api/speech-recognition/config')).toBe(true);
    });
    const saveCall = mocks.jarvisFetch.mock.calls.find(([path]) => path === '/api/speech-recognition/config');
    expect(saveCall?.[1]).toMatchObject({ method: 'PUT' });
    expect(JSON.parse(String((saveCall?.[1] as RequestInit).body))).toEqual({
      values: { defaultModel: { provider: 'openai', id: 'whisper-1' } },
    });
  });

  it('does not offer speech models without runnable adapters as selectable defaults', async () => {
    mocks.jarvisFetch.mockImplementation((path: string) => {
      if (path === '/api/media/image/providers') {
        return Promise.resolve(jsonResponse({ providers: {}, config: {} }));
      }
      if (path === '/api/speech-recognition/providers') {
        return Promise.resolve(jsonResponse({
          providers: {
            openai: {
              providerId: 'openai',
              displayName: 'OpenAI Speech',
              hasCredentials: true,
              models: [{ id: 'whisper-1', name: 'Whisper 1', adapterAvailable: false }],
              availableModels: [],
            },
          },
          config: { enabled: true },
        }));
      }
      return Promise.resolve(jsonResponse({ values: {} }));
    });

    render(<MediaTab />);

    const select = await screen.findByLabelText('语音条转录模型');
    const option = Array.from(select.querySelectorAll('option')).find((item) => item.value === 'openai/whisper-1');
    expect(option).toBeUndefined();
    expect(select).toBeDisabled();
  });

  it('keeps snapshot speech config when speech provider loading fails', async () => {
    useSettingsStore.setState({
      settingsSnapshot: {
        key: 'local:snapshot:agent-a',
        status: 'ready',
        data: {
          preferences: {
            speechRecognition: { enabled: true },
          },
        },
        error: null,
        requestId: 1,
        updatedAt: Date.now(),
      } as any,
    });
    mocks.jarvisFetch.mockImplementation((path: string) => {
      if (path === '/api/media/image/providers') {
        return Promise.resolve(jsonResponse({ providers: {}, config: {} }));
      }
      if (path === '/api/speech-recognition/providers') {
        return Promise.reject(new Error('speech unavailable'));
      }
      return Promise.resolve(jsonResponse({ values: {} }));
    });

    render(<MediaTab />);

    const toggle = await screen.findByRole('switch', { name: '发送语音条时转录' });
    await waitFor(() => {
      expect(mocks.jarvisFetch).toHaveBeenCalledWith('/api/speech-recognition/providers');
    });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});
