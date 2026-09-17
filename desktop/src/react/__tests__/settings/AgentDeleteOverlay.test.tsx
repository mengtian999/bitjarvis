/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState: Record<string, any> = {};

vi.mock('../../settings/store', () => ({
  useSettingsStore: Object.assign((selector?: (state: Record<string, any>) => unknown) => (
    selector ? selector(mockState) : mockState
  ), {
    setState: vi.fn((patch: Record<string, unknown>) => Object.assign(mockState, patch)),
  }),
}));

vi.mock('../../settings/api', () => ({
  jarvisFetch: vi.fn(),
}));

vi.mock('../../settings/actions', () => ({
  switchToAgent: vi.fn(),
  loadSettingsConfig: vi.fn(),
  loadAgents: vi.fn(),
}));

vi.mock('../../settings/helpers', () => ({
  t: (key: string, params?: Record<string, string>) => (
    params?.name ? `${key}:${params.name}` : key
  ),
}));

describe('AgentDeleteOverlay', () => {
  beforeEach(() => {
    Object.keys(mockState).forEach(key => delete mockState[key]);
    Object.assign(mockState, {
      agents: [
        { id: 'jarvis', name: '小花', yuan: 'jarvis', isPrimary: true },
        { id: 'deepseek', name: 'DeepSeek', yuan: 'deepseek', isPrimary: false },
      ],
      currentAgentId: 'jarvis',
      settingsAgentId: 'jarvis',
      showToast: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('uses the explicit event target instead of the selected settings agent', async () => {
    const { AgentDeleteOverlay } = await import('../../settings/overlays/AgentDeleteOverlay');
    render(<AgentDeleteOverlay />);

    act(() => {
      window.dispatchEvent(new CustomEvent('jarvis-show-agent-delete', {
        detail: { agentId: 'deepseek' },
      }));
    });

    expect(screen.getByRole('heading', { name: 'settings.agent.deleteTitle1:DeepSeek' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'settings.agent.deleteTitle1:小花' })).not.toBeInTheDocument();
  });

  it('deletes the active agent through the backend without switching first', async () => {
    const { jarvisFetch } = await import('../../settings/api');
    const actions = await import('../../settings/actions');
    (jarvisFetch as any).mockResolvedValue({ json: async () => ({ ok: true, replacementAgentId: 'deepseek' }) });
    const { AgentDeleteOverlay } = await import('../../settings/overlays/AgentDeleteOverlay');
    render(<AgentDeleteOverlay />);

    act(() => {
      window.dispatchEvent(new CustomEvent('jarvis-show-agent-delete', {
        detail: { agentId: 'jarvis' },
      }));
    });
    fireEvent.click(screen.getByText('settings.agent.deleteNext'));
    fireEvent.change(screen.getByPlaceholderText('settings.agent.deletePlaceholder'), {
      target: { value: '小花' },
    });
    fireEvent.click(screen.getByText('settings.agent.deleteConfirm'));

    await waitFor(() => expect(jarvisFetch).toHaveBeenCalledWith('/api/agents/jarvis', { method: 'DELETE' }));
    expect(actions.switchToAgent).not.toHaveBeenCalled();
    expect(actions.loadAgents).toHaveBeenCalled();
    expect(actions.loadSettingsConfig).toHaveBeenCalled();
  });
});
