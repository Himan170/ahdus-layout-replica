// @vitest-environment jsdom
// v0.18.6 (Astra audit): the Inspector's boxes. A locked item's place, angle and size can't be typed (6);
// a room's size is a draft until Enter or leaving the box, Esc cancels it, and it shows what is saved (3a).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import Inspector, { formatField } from '../Inspector';

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
  describe("a room's size (audit 3a)", () => {
    const show = (room, onUpdateRoom) => render(<Inspector mode="room" room={room} floorName="Ground Floor" rooms={[room]} objects={[]}
      onUpdateRoom={onUpdateRoom} />);

    it('the boxes are Width, Depth and Wall height', () => {
      show(office(), () => {});
      expect(field('Width')).not.toBeNull();
      expect(field('Depth')).not.toBeNull();
      expect(field('Wall height')).not.toBeNull();
      expect(field('Length')).toBeNull();
      expect(field('Ceiling')).toBeNull();
    });

    it('typing 1 then 2 changes nothing until Enter, then once: 12 m', () => {
      const onUpdateRoom = vi.fn();
      show(office(), onUpdateRoom);
      const w = field('Width');
      act(() => w.focus());
      type(w, '1');
      type(w, '12');
      expect(onUpdateRoom).not.toHaveBeenCalled();
      key(w, 'Enter');
      expect(onUpdateRoom).toHaveBeenCalledTimes(1);
      expect(onUpdateRoom).toHaveBeenCalledWith('room_office', { width: 12 });
    });

    it('Esc puts the saved size back and sends nothing', () => {
      const onUpdateRoom = vi.fn();
      show(office(), onUpdateRoom);
      const w = field('Width');
      act(() => w.focus());
      type(w, '4');
      key(w, 'Escape');
      expect(onUpdateRoom).not.toHaveBeenCalled();
      expect(field('Width').value).toBe('10.0');
    });

    it('focus selects what is there, so typing replaces it', () => {
      const select = vi.spyOn(HTMLInputElement.prototype, 'select');
      show(office(), () => {});
      act(() => field('Depth').focus());
      expect(select).toHaveBeenCalled();
      select.mockRestore();
    });

    it('shows what is saved: 12.34 m, not 12.3', () => {
      show(office({ width: 12.34, depth: 5.925 }), () => {});
      expect(field('Width').value).toBe('12.34');
      expect(field('Depth').value).toBe('5.925');
      expect(formatField(10, 1, true)).toBe('10.0');
      expect(formatField(3.2, 1, true)).toBe('3.2');
    });
  });
  describe("a room's floor (audit 5a + 10)", () => {
    const chip = (choice) => container.querySelector(`[data-floor-choice="${choice}"]`);
    it('Room default comes first and is chosen for a Cabin that never chose a floor; it says Walnut', () => {
      const onSetFloorFinish = vi.fn();
      const cabin = office({ type: 'CABIN', name: 'Cabin' });
      render(<Inspector mode="room" room={cabin} floorName="Ground Floor" rooms={[cabin]} objects={[]} onUpdateRoom={() => {}}
        onSetFloorFinish={onSetFloorFinish} />);
      const choices = [...container.querySelectorAll('[data-floor-choice]')].map((b) => b.dataset.floorChoice);
      expect(choices).toEqual(['default', 'wood', 'carpet', 'tile', 'concrete']);
      expect(chip('default').getAttribute('aria-checked')).toBe('true');
      expect(container.querySelector('[data-floor-name]').textContent).toBe('Walnut (room default)');
      act(() => chip('wood').click());
      expect(onSetFloorFinish).toHaveBeenCalledWith('room_office', 'wood');
    });
    it('a chosen floor is checked, and Room default takes it back', () => {
      const onSetFloorFinish = vi.fn();
      const cabin = office({ type: 'CABIN', floorFinish: 'tile' });
      render(<Inspector mode="room" room={cabin} floorName="Ground Floor" rooms={[cabin]} objects={[]} onUpdateRoom={() => {}}
        onSetFloorFinish={onSetFloorFinish} />);
      expect(chip('tile').getAttribute('aria-checked')).toBe('true');
      expect(chip('default').getAttribute('aria-checked')).toBe('false');
      act(() => chip('default').click());
      expect(onSetFloorFinish).toHaveBeenCalledWith('room_office', 'default');
    });
    it("each chip shows the floor's own photo", () => {
      render(<Inspector mode="room" room={office()} floorName="Ground Floor" rooms={[office()]} objects={[]} onUpdateRoom={() => {}} />);
      expect(chip('wood').querySelector('.insp-swatch__chip').style.backgroundImage).toContain('herringbone_parquet');
      expect(chip('carpet').querySelector('.insp-swatch__chip').style.backgroundImage).toContain('carpet_office');
    });
  });
});

