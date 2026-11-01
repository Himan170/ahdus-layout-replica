// @vitest-environment jsdom
// AHDUS mode, not logged in: Studio sends the browser to AHDUS's login page (no
// token, or the first load answers 401). The editor is mocked (no Babylon here);
// goToLogin's address is tested with a mocked location in ahdusBackend.test.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../components/WorkplaceEditor', () => ({ default: () => <div>Studio</div> }));
vi.mock('../components/CompanySelector', () => ({ default: () => <div>Companies</div> }));
vi.mock('../services/ahdusBackend', async (importOriginal) => ({
  ...(await importOriginal()),
  goToLogin: vi.fn(),
}));

const { default: App } = await import('../App');
const { goToLogin } = await import('../services/ahdusBackend');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('App in AHDUS mode, not logged in', () => {
  let container;
  let root;

  beforeEach(() => {
    vi.stubEnv('VITE_LAYOUT_BACKEND', 'ahdus');
    window.history.replaceState(null, '', '/workplace-studio/?site=site-1');
    localStorage.clear();
    goToLogin.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('no authToken: goes to the login page without asking AHDUS for the layout', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await act(async () => root.render(<App />));
    expect(goToLogin).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Taking you to the AHDUS login');
  });

  it('the first load answers 401: goes to the login page', async () => {
    localStorage.setItem('authToken', 'old-token');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ detail: 'expired' }) })));
    await act(async () => root.render(<App />));
    expect(goToLogin).toHaveBeenCalled();
    expect(container.textContent).not.toContain('could not be opened');
  });

  it('another refusal (403) shows why, and stays here', async () => {
    localStorage.setItem('authToken', 'token');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })));
    await act(async () => root.render(<App />));
    expect(goToLogin).not.toHaveBeenCalled();
    expect(container.textContent).toContain('This workplace could not be opened');
  });

  it('"Try again" loads once more (the loading screen, then the editor)', async () => {
    localStorage.setItem('authToken', 'token');
    const draft = { layout: null, revision: 0, name: 'HQ' };
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 0, json: async () => ({}) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => draft });
    vi.stubGlobal('fetch', fetchSpy);
    await act(async () => root.render(<App />));
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Try again'));
    expect(retry).toBeTruthy();
    await act(async () => retry.click());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Studio'); // the (mocked) editor
    expect(container.querySelector('[data-splash="loading"]')).not.toBeNull(); // until its first frame
  });
});
