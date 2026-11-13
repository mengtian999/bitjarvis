import { describe, expect, it } from 'vitest';
import { isChineseLocale, localizedModelName } from '../../utils/localized-model-name';

describe('localizedModelName', () => {
  const gatewayTier = { id: 'auto', name: '贾维斯 (自动)', nameEn: 'Jarvis (Auto)' };

  it('uses the Chinese name for Chinese locales', () => {
    expect(localizedModelName(gatewayTier, 'zh-CN')).toBe('贾维斯 (自动)');
    expect(localizedModelName(gatewayTier, 'zh-TW')).toBe('贾维斯 (自动)');
  });

  it('uses the English name for non-Chinese locales', () => {
    expect(localizedModelName(gatewayTier, 'en')).toBe('Jarvis (Auto)');
    expect(localizedModelName(gatewayTier, 'ja')).toBe('Jarvis (Auto)');
    expect(localizedModelName(gatewayTier, 'de-AT')).toBe('Jarvis (Auto)');
  });

  it('falls back to the Chinese name when no English name exists', () => {
    expect(localizedModelName({ id: 'gpt-5', name: 'GPT-5' }, 'en')).toBe('GPT-5');
  });

  it('keeps the historical Chinese label before locale is loaded', () => {
    expect(localizedModelName(gatewayTier, '')).toBe('贾维斯 (自动)');
    expect(localizedModelName(gatewayTier, null)).toBe('贾维斯 (自动)');
    expect(localizedModelName(gatewayTier, undefined)).toBe('贾维斯 (自动)');
  });

  it('falls back to the id when the name is empty', () => {
    expect(localizedModelName({ id: 'plain' }, 'en')).toBe('plain');
    expect(localizedModelName(null, 'en')).toBe('');
  });

  it('detects Chinese locale prefixes case-insensitively', () => {
    expect(isChineseLocale('zh')).toBe(true);
    expect(isChineseLocale('ZH-hant')).toBe(true);
    expect(isChineseLocale('en')).toBe(false);
    expect(isChineseLocale(undefined)).toBe(false);
  });
});