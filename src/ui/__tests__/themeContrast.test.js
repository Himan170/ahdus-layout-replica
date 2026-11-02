// The AHDUS look (theme.css, :root[data-look="ahdus"]): every text colour is at least 4.5:1
// (WCAG AA) on the backgrounds it is used on. Reads the tokens from the CSS file itself.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../theme.css', import.meta.url)), 'utf8');

function tokens(selector) {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const T = tokens(':root[data-look="ahdus"]');

// [text token, background token]: every pair the AHDUS look draws text with
const PAIRS = [
  ['text', 'bg-panel'], ['text', 'bg-app'], ['text', 'bg-hover'], ['text', 'bg-active'], ['text', 'bg-canvas'],
  ['text-muted', 'bg-panel'], ['text-muted', 'bg-app'], ['text-muted', 'bg-hover'], ['text-muted', 'bg-active'],
  ['text-muted', 'bg-canvas'],
  ['on-accent', 'accent'], ['on-accent', 'accent-hover'], ['on-accent', 'accent-strong'],
  ['accent', 'bg-panel'], ['accent', 'accent-soft'], ['accent', 'bg-app'],
  ['warning-text', 'warning-bg'],
  ['danger', 'bg-panel'], ['danger', 'danger-soft'],
  ['rail-text', 'rail-bg'], ['rail-text', 'rail-hover'], ['on-accent', 'rail-active'],
];

describe('AHDUS look colours', () => {
  it('has the approved palette', () => {
    expect(T).toMatchObject({
      'bg-app': '#f6f7f3', 'bg-panel': '#ffffff', border: '#e3e8e0', text: '#25382f', 'text-muted': '#55625a',
      accent: '#28664f', 'accent-hover': '#1c503d', 'accent-soft': '#eaf2e6', 'rail-bg': '#193b2f',
      'warning-bg': '#fbf2e3', 'warning-text': '#7a4e0e', 'warning-dot': '#c27c12',
    });
  });

  it.each(PAIRS)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(T[fg], fg).toBeDefined();
    expect(T[bg], bg).toBeDefined();
    expect(contrast(T[fg], T[bg])).toBeGreaterThanOrEqual(4.5);
  });
});
