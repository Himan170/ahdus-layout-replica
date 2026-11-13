// @vitest-environment jsdom
// v0.16.2: an Enter (or Esc) that an IME uses while composing a word (Hindi, Japanese, Chinese
// input tools) never saves or cancels a name half typed: utils/keys.js, and the real rename field
// of Studio's top bar (StudioHeader's LayoutName).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import StudioHeader from '../StudioHeader';
import { isCommitEnter, isComposing } from '../../utils/keys';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('isCommitEnter / isComposing', () => {
  it('a plain Enter commits', () => {
    expect(isCommitEnter({ key: 'Enter', isComposing: false, keyCode: 13 })).toBe(true);
    expect(isCommitEnter(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(true);
  });

  it('an Enter while an IME composes does not', () => {
    expect(isCommitEnter({ key: 'Enter', isComposing: true, keyCode: 13 })).toBe(false);
    expect(isCommitEnter(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))).toBe(false);
  });

  it('keyCode 229 (Safari ends a composition with it) does not', () => {
    expect(isCommitEnter({ key: 'Enter', isComposing: false, keyCode: 229 })).toBe(false);
    expect(isComposing({ key: 'Escape', keyCode: 229 })).toBe(true);
  });

  it("reads React's event through its nativeEvent", () => {
    const reactLike = { key: 'Enter', keyCode: 13, nativeEvent: { isComposing: true } };
    expect(isComposing(reactLike)).toBe(true);
    expect(isCommitEnter(reactLike)).toBe(false);
    expect(isCommitEnter({ key: 'Enter', keyCode: 13, nativeEvent: { isComposing: false } })).toBe(true);
  });

  it('other keys and nothing at all are not a commit', () => {
    expect(isCommitEnter({ key: 'a' })).toBe(false);
    expect(isCommitEnter({ key: 'Escape' })).toBe(false);
    expect(isCommitEnter(null)).toBe(false);
    expect(isComposing(undefined)).toBe(false);
  });
});

const settings = {
  snapEnabled: true, onSnapToggle() {}, snapStep: 0.5, onSnapStepChange() {}, showGrid: false,
  onShowGridToggle() {}, environment: 'day', onEnvironmentChange() {}, fpsRef: { current: null },
  realisticLook: true, onRealisticLookToggle() {}, roomLabels: 'names', onRoomLabelsChange() {},
};

describe("the layout name field (Studio's top bar)", () => {
  let container;
  let root;
  let onRename;

  /** A keydown as the browser sends it; `keyCode` set by hand (not every KeyboardEventInit has it). */
  const press = (el, key, { composing = false, keyCode } = {}) => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: composing });
    if (keyCode !== undefined) Object.defineProperty(ev, 'keyCode', { value: keyCode });
    act(() => { el.dispatchEvent(ev); });
  };
  const type = (el, value) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    act(() => {
      set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const nameInput = () => container.querySelector('input[aria-label="Layout name"]');
  const startRenaming = () => {
    const button = container.querySelector('button[title="Rename this layout"]');
    act(() => { button.click(); });
    const input = nameInput();
    expect(input).not.toBeNull();
    return input;
  };

  beforeEach(() => {
    localStorage.clear();
    onRename = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(
      <StudioHeader
        layoutName="HQ North" onRenameLayout={onRename} onAllLayouts={() => {}} publishState="unknown"
        saveStatus="saved" saveError={null} undoState={{ canUndo: false, canRedo: false }}
        onUndo={() => {}} onRedo={() => {}} editor={null} onMessage={() => {}} onPreview={() => {}}
        settings={settings}
      />,
    ));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('an Enter that ends an IME composition saves nothing and keeps the field open', () => {
    const input = startRenaming();
    type(input, 'मुख्य');
    press(input, 'Enter', { composing: true });
    press(input, 'Enter', { keyCode: 229 });
    expect(onRename).not.toHaveBeenCalled();
    expect(nameInput()).toBe(input);
  });

  it("an IME's Esc does not cancel the rename", () => {
    const input = startRenaming();
    type(input, '本社');
    press(input, 'Escape', { composing: true });
    expect(nameInput()).toBe(input);
  });

  it('a normal Enter still saves the whole name', () => {
    const input = startRenaming();
    type(input, 'मुख्य कार्यालय');
    press(input, 'Enter', { composing: true }); // the IME's Enter picks the word
    press(input, 'Enter'); // then the user's Enter saves
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('मुख्य कार्यालय');
    expect(nameInput()).toBeNull();
  });
});
