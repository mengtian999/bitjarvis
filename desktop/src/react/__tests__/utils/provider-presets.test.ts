import { describe, expect, it } from 'vitest';

import { API_PROVIDER_PRESETS, getProviderPresetLabel } from '../../utils/provider-presets';

describe('provider presets', () => {
  it('exposes xAI Grok through the OpenAI-compatible API key flow', () => {
    expect(API_PROVIDER_PRESETS).toContainEqual(expect.objectContaining({
      value: 'xai',
      label: 'xAI (Grok)',
      url: 'https://api.x.ai/v1',
      api: 'openai-completions',
    }));
  });

  it('labels the Jarvis gateway preset per UI locale', () => {
    const jarvis = API_PROVIDER_PRESETS.find(preset => preset.value === 'jarvis-gateway')!;
    expect(getProviderPresetLabel(jarvis, 'en')).toBe('Jarvis Cloud');
    expect(getProviderPresetLabel(jarvis, 'ja')).toBe('Jarvis Cloud');
    expect(getProviderPresetLabel(jarvis, 'zh-CN')).toBe('贾维斯(通用)');
    expect(getProviderPresetLabel(jarvis, 'zh-TW')).toBe('賈維斯(通用)');
  });
});
