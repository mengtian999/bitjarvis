// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelWarningModal } from '../../components/channels/ChannelWarningModal';

vi.mock('../../hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      'channel.warningTitle': 'About channels',
      'channel.warningBody': 'First paragraph\n\nSecond paragraph',
      'channel.createCancel': 'Cancel',
      'channel.warningConfirm': 'Enable channels',
    })[key] ?? key,
  }),
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('ChannelWarningModal', () => {
  it('renders at the window surface instead of inside the function panel ancestor', () => {
    vi.useFakeTimers();
    const functionPanel = document.createElement('aside');
    functionPanel.style.transform = 'translateX(1px)';
    functionPanel.style.overflow = 'hidden';
    const mount = document.createElement('div');
    functionPanel.append(mount);
    document.body.append(functionPanel);

    render(
      <ChannelWarningModal open onConfirm={() => {}} onCancel={() => {}} />,
      { container: mount },
    );
    act(() => vi.advanceTimersByTime(250));

    const dialog = screen.getByRole('dialog', { name: 'About channels' });
    expect(functionPanel.contains(dialog)).toBe(false);
    expect(dialog.textContent).toContain('First paragraph');
    expect(dialog.textContent).toContain('Second paragraph');
  });

  it('maps Escape and both actions to the existing business callbacks', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ChannelWarningModal open onConfirm={onConfirm} onCancel={onCancel} />);
    act(() => vi.advanceTimersByTime(250));

    fireEvent.keyDown(screen.getByRole('heading', { name: 'About channels' }), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enable channels' }));

    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
