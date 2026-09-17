/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorList } from '../ConnectorList';
import type { McpConnector } from '../types';

vi.mock('../../../helpers', () => ({
  t: (key: string) => key,
}));

function connector(overrides: Partial<McpConnector> = {}): McpConnector {
  return {
    id: 'alpha',
    name: 'Alpha',
    transport: 'remote',
    url: 'https://alpha.example.com/mcp',
    status: 'stopped',
    tools: [],
    ...overrides,
  };
}

function renderList(props: Partial<React.ComponentProps<typeof ConnectorList>> = {}) {
  const onOpen = vi.fn();
  const onAction = vi.fn();
  const onRemove = vi.fn();
  render(
    <ConnectorList
      connectors={[connector()]}
      globalEnabled
      busyKeys={new Set()}
      agentConfig={{ connectors: {} }}
      onOpen={onOpen}
      onAction={onAction}
      onRemove={onRemove}
      {...props}
    />,
  );
  return { onOpen, onAction, onRemove };
}

afterEach(cleanup);

describe('ConnectorList', () => {
  it('shows the runtime error a failed connector recorded', () => {
    renderList({
      connectors: [connector({ status: 'failed', error: 'spawn ENOENT' })],
    });

    // "failed" on its own says nothing actionable; the recorded reason is the
    // point of looking at the row.
    expect(screen.getByTestId('mcp-connector-error-alpha').textContent).toBe('spawn ENOENT');
  });

  it('does not render an error line for a healthy connector', () => {
    renderList({ connectors: [connector({ status: 'running' })] });

    expect(screen.queryByTestId('mcp-connector-error-alpha')).toBeNull();
  });

  it('opens the detail view when the row is clicked', () => {
    const { onOpen } = renderList();

    fireEvent.click(screen.getByTestId('mcp-connector-row-alpha'));

    expect(onOpen).toHaveBeenCalledWith('alpha');
  });

  it('opens the detail view from the keyboard', () => {
    const { onOpen } = renderList();

    fireEvent.keyDown(screen.getByTestId('mcp-connector-row-alpha'), { key: 'Enter' });

    expect(onOpen).toHaveBeenCalledWith('alpha');
  });

  it('hands removal to the caller rather than deciding by itself', () => {
    const { onRemove } = renderList();

    fireEvent.click(screen.getByText('common.remove'));

    // The row asks; the confirmation is a real dialog owned by the tab, not a
    // blocking window.confirm.
    expect(onRemove).toHaveBeenCalledWith('alpha');
  });

  it('keeps one connector busy from disabling another', () => {
    renderList({
      connectors: [connector(), connector({ id: 'beta', name: 'Beta' })],
      busyKeys: new Set(['start-alpha']),
    });

    const startButtons = screen.getAllByText('settings.mcp.start') as HTMLButtonElement[];
    expect(startButtons[0].disabled).toBe(true);
    expect(startButtons[1].disabled).toBe(false);
  });

  it('does not disable edit and remove through one shared key', () => {
    renderList({ busyKeys: new Set(['remove-alpha']) });

    const manage = screen.getByText('settings.mcp.manage') as HTMLButtonElement;
    const remove = screen.getByText('common.remove') as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    // Managing a connector is a read; a pending removal has no reason to block it.
    expect(manage.disabled).toBe(false);
  });

  it('counts the agents the connector is enabled for', () => {
    renderList({
      connectors: [connector({ tools: [{ name: 'search' }] })],
      agentConfig: { connectors: { alpha: { enabled: true } } },
    });

    expect(screen.getByText(/1 settings\.mcp\.enabledAgentsCount/)).toBeTruthy();
  });

  it('offers stop instead of start once the connector is live', () => {
    renderList({ connectors: [connector({ status: 'running' })] });

    expect(screen.queryByText('settings.mcp.start')).toBeNull();
    expect(screen.getByText('settings.mcp.stop')).toBeTruthy();
  });
});
