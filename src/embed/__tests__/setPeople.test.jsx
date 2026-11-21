// @vitest-environment jsdom
// v0.18.7 (Astra audit 11): `await workplace.setPeople(list)` resolves only once the viewer gave the list to the
// engine, so find() right after it knows them (it answered [] : the viewer applies people in an effect, after
// React's render). A second list given at once replaces the first.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const engines = [];
vi.mock('../../engine/react/LayoutViewer', async () => {
  const React = await import('react');
  /** A stand-in for the viewer: an engine at once, people given to it in an effect (as the real one does). */
  function LayoutViewer(props) {
    const [engine] = React.useState(() => {
      const state = { layoutName: 'Test', floors: { 0: { id: 0, name: 'Ground Floor' } }, rooms: {} };
      const e = {
        mode: 'view',
        people: [],
        setPeople(list) { this.people = list; },
        navigation: {
          find: (q) => e.people.filter((p) => p.name.toLowerCase().includes(String(q).toLowerCase())).map((p) => ({ id: `person:${p.personId}` })),
        },
        getStore: () => ({ getState: () => state, subscribe: () => () => {} }),
        on: () => () => {},
        babylonEngine: { resize() {} },
      };
      engines.push(e);
      return e;
    });
    const { people, onReady, onPeopleApplied } = props;
    React.useEffect(() => { onReady?.(engine); }, [engine]); // eslint-disable-line react-hooks/exhaustive-deps
    React.useEffect(() => {
      engine.setPeople(people ?? []);
      onPeopleApplied?.(people ?? []);
    }, [engine, people]); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
  }
  return { LayoutViewer };
});

const { mount } = await import('../index.jsx');
const sample = JSON.parse(readFileSync(join(process.cwd(), 'embed-sample.ahdus.json'), 'utf8'));

let workplace;
afterEach(() => { workplace?.destroy(); document.body.innerHTML = ''; engines.length = 0; });

describe('setPeople resolves when Find knows the people (v0.18.7)', () => {
  it('find() right after the await finds them; a second list at once replaces the first', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    workplace = mount(el, { layout: sample });
    await workplace.ready;
    expect(await workplace.setPeople([{ personId: 'p_asha', deskId: 'obj_1', name: 'Asha Patel', department: 'Engineering' }])).toBe(1);
    expect(workplace.find('asha')).toEqual([{ id: 'person:p_asha' }]);

    const first = workplace.setPeople([{ personId: 'p_ravi', deskId: 'obj_2', name: 'Ravi Kumar' }]);
    const second = workplace.setPeople([{ personId: 'p_meera', deskId: 'obj_3', name: 'Meera Shah' }]);
    await Promise.all([first, second]);
    expect(workplace.find('meera')).toEqual([{ id: 'person:p_meera' }]);
    expect(workplace.find('asha')).toEqual([]);
  });

  it('given before the layout is drawn: it waits for it, then find() knows them', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    workplace = mount(el, { layout: sample });
    const n = await workplace.setPeople([{ personId: 'p_asha', deskId: 'obj_1', name: 'Asha Patel' }]);
    expect(n).toBe(1);
    expect(workplace.find('asha')).toEqual([{ id: 'person:p_asha' }]);
  });

  it('destroyed while waiting: it resolves with 0, nothing hangs', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    workplace = mount(el, { layout: sample });
    const p = workplace.setPeople([{ personId: 'p_asha', deskId: 'obj_1', name: 'Asha Patel' }]);
    workplace.destroy();
    expect(await p).toBe(0);
  });
});
