/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TutorialStep } from '../TutorialStep';
import type { JarvisFetch } from '../../onboarding-actions';

describe('TutorialStep', () => {
  beforeEach(() => {
    vi.stubGlobal('t', (key: string) => key);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not complete onboarding when saved settings fail read-back verification', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onboardingComplete = vi.fn(async () => {});
    const showError = vi.fn();
    const jarvisFetch = vi.fn<JarvisFetch>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ locale: 'zh-CN' }),
    } as Response));
    vi.stubGlobal('jarvis', { onboardingComplete });

    render(
      <TutorialStep
        preview={false}
        jarvisFetch={jarvisFetch}
        agentId="renamed-primary"
        verificationPlan={{ agentConfig: { locale: 'en' }, preferenceModels: {}, requiredAgentSecretPaths: [] }}
        showError={showError}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'onboarding.tutorial.finish' }));

    await waitFor(() => {
      expect(showError).toHaveBeenCalledWith(expect.stringContaining('agent config.locale'));
    });
    expect(jarvisFetch).toHaveBeenCalledWith('/api/agents/renamed-primary/config');
    expect(onboardingComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'onboarding.tutorial.finish' })).toBeEnabled();
  });
});
