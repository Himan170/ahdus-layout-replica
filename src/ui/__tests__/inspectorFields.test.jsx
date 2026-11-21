// @vitest-environment jsdom
// v0.18.6 (Astra audit): the Inspector's boxes. A locked item's place, angle and size can't be typed (6);
// a room's size is a draft until Enter or leaving the box, Esc cancels it, and it shows what is saved (3a).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import Inspector from '../Inspector';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const desk = (extra = {}) => ({
  id: 'obj_desk', assetType: 'DESK_STANDARD', label: 'Desk', x: 0, y: 0, z: 0, floor: 0,
  rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, ...extra,
});
const office = (extra = {}) => ({
  id: 'room_office', name: 'Office', type: 'OFFICE', floor: 0, x: 0, z: 0, width: 10, depth: 8,
  wallHeight: 3.2, color: '#ccc', doors: [], windows: [], ...extra,
});

describe('the Inspector boxes (v0.18.6)', () => {
  let container;
  let root;
  const render = (el) => act(() => root.render(el));
  const field = (label) => container.querySelector(`input[aria-label="${label}"]`);
  const type = (input, value) => act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const key = (input, k) => act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("a locked item's position, angle and size boxes are disabled (audit 6)", () => {
    render(<Inspector mode="object" object={desk({ isLocked: true })} floorName="Ground Floor" rooms={[]} objects={[]} onUpdateObject={() => {}} />);
    for (const label of ['X', 'Z', 'Height', 'Angle', 'Width', 'Depth']) expect(field(label).disabled).toBe(true);
    expect(container.querySelector('[data-item-locked]')).not.toBeNull();
    render(<Inspector mode="object" object={desk()} floorName="Ground Floor" rooms={[]} objects={[]} onUpdateObject={() => {}} />);
    expect(field('Width').disabled).toBe(false);
  });
});
