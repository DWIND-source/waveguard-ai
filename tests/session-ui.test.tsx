// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import { PrefsProvider } from '../src/lib/i18n';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ gemini: false, model: null }) }));
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('active session preferences', () => {
  it('preserves the input, paused playback position and run when switching languages and themes', async () => {
    render(<PrefsProvider><App /></PrefsProvider>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tạm dừng' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Tạm dừng' }));
    const textbox = screen.getByRole('textbox');
    fireEvent.change(textbox, { target: { value: 'My custom incident' } });
    fireEvent.change(screen.getByRole('slider'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(document.documentElement.lang).toBe('en');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('My custom incident');
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('123');
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('123');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    fireEvent.click(screen.getByRole('button', { name: 'VI' }));
    expect(document.documentElement.lang).toBe('vi');
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('123');
  });
  it('runs the real preset and reaches the final timestamp with working export controls', async () => {
    render(<PrefsProvider><App /></PrefsProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run coordination demo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export report' })).toBeTruthy(), { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Jump to end' }));
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.value).toBe(slider.max);
    expect(slider.max).toBe('1500');
    expect(screen.getByText('Explanation & results')).toBeTruthy();
    // SVG references must remain local to each of the three simultaneously rendered maps.
    const ids = [...document.querySelectorAll('svg [id]')].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
