/**
 * v0.17.1: the quality step's shadows switched over frames, a batch of meshes at a time (ShadowSwitch). The light's
 * own flag is never flipped (that froze a frame whatever received): off = no mesh receives.
 */
import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

import { ShadowSwitch, FIRST_BATCH, SCAN_FRAMES, WAIT_FRAMES } from '../systems/ShadowSwitch';

/** n meshes, 10 per material (9 of them receive: every 10th one never does). */
function setup(n = 100) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const materials = Array.from({ length: Math.ceil(n / 10) }, (_, i) => new StandardMaterial(`mat${i}`, scene));
  const meshes = Array.from({ length: n }, (_, i) => {
    const m = MeshBuilder.CreateBox(`box${i}`, { size: 1 }, scene);
    m.material = materials[Math.floor(i / 10)];
    m.receiveShadows = i % 10 !== 0;
    return m;
  });
  let t = 0;
  let frameMs = 16;
  // a NullEngine never compiles shaders: "ready" is the test's to say (true: at once)
  let ready = true;
  const sw = new ShadowSwitch(scene, { now: () => t, isReady: () => ready });
  const frame = () => { t += frameMs; scene.onBeforeRenderObservable.notifyObservers(scene); };
  const settle = (max = 50) => { for (let i = 0; i < max && sw.busy; i++) frame(); };
  return { scene, meshes, sw, frame, settle, setFrameMs: (ms: number) => { frameMs = ms; }, setReady: (r: boolean) => { ready = r; } };
}

const receiving = (meshes: { receiveShadows: boolean }[]) => meshes.filter((m) => m.receiveShadows).length;
/** The receivers of one material. */
const PER = 9;

describe('ShadowSwitch (v0.17.1)', () => {
  it('off: a batch of materials per frame stops receiving (held); on: the held ones receive again, the same way', () => {
    const { meshes, sw, frame, settle } = setup();
    expect(sw.shadowsOn).toBe(true);
    sw.set(false);
    expect(sw.shadowsOn).toBe(false);
    expect(sw.busy).toBe(true);
    expect(receiving(meshes)).toBe(90); // nothing changed yet
    frame(); // the first frame (no time measured yet): one material, all its meshes
    expect(receiving(meshes)).toBe(90 - PER * FIRST_BATCH);
    frame();
    expect(receiving(meshes)).toBe(90 - PER * FIRST_BATCH * 3); // quick frames: the batch doubles
    settle();
    expect(sw.busy).toBe(false);
    expect(receiving(meshes)).toBe(0);
    expect(sw.heldCount).toBe(90);
    sw.set(true);
    frame();
    expect(receiving(meshes)).toBe(PER * FIRST_BATCH);
    settle();
    expect(receiving(meshes)).toBe(90);
    expect(meshes[0].receiveShadows).toBe(false); // one that never received stays so
  });

  it('a slow frame halves the batch; asked again for what it is already: nothing', () => {
    const { meshes, sw, frame, settle, setFrameMs } = setup(400);
    for (let i = 0; i < 5; i++) frame(); // the usual frame: 16 ms
    sw.set(false);
    frame(); // 1 material
    frame(); // 2
    frame(); // 4
    setFrameMs(400);
    frame(); // slow: 2
    expect(receiving(meshes)).toBe(360 - PER * (1 + 2 + 4 + 2));
    settle(400);
    expect(sw.busy).toBe(false);
    sw.set(false);
    expect(sw.busy).toBe(false);
  });

  it('turned round half way, both ways: nothing lost', () => {
    const { meshes, sw, frame, settle } = setup();
    sw.set(false);
    frame();
    frame();
    sw.set(true); // those taken off come back; the rest never went
    settle();
    expect(receiving(meshes)).toBe(90);
    sw.set(false);
    settle();
    sw.set(true);
    frame();
    sw.set(false); // those not given back yet stay held
    settle();
    expect(receiving(meshes)).toBe(0);
    expect(sw.heldCount).toBe(90);
    sw.set(true);
    settle();
    expect(receiving(meshes)).toBe(90);
  });

  it('shadows off: meshes built meanwhile are held too (a scan every few frames), and come back on', () => {
    const { scene, meshes, sw, frame, settle } = setup(20);
    sw.set(false);
    settle();
    const late = MeshBuilder.CreateBox('late', { size: 1 }, scene);
    late.receiveShadows = true;
    for (let i = 0; i < SCAN_FRAMES + 2; i++) frame();
    expect(late.receiveShadows).toBe(false);
    sw.set(true);
    settle();
    expect(late.receiveShadows).toBe(true);
    expect(receiving(meshes)).toBe(18);
  });

  it('a device whose every frame is slow (software WebGL, ~400 ms): compared with its usual frame, it still finishes soon', () => {
    const { meshes, sw, frame, settle, setFrameMs } = setup(1000);
    setFrameMs(400);
    for (let i = 0; i < 60; i++) frame(); // nothing switches: the usual frame is measured
    expect(sw.usualFrame).toBeGreaterThan(380);
    setFrameMs(420); // the switch's frames: a little longer than usual
    sw.set(false);
    settle(30);
    expect(sw.busy).toBe(false);
    expect(sw.frames).toBeLessThan(10); // 1, 2, 4, … materials (never halved)
    expect(sw.heldCount).toBe(900);
    setFrameMs(700); // much longer than usual: the batch never grows
    sw.set(true);
    frame(); // 1
    frame(); // slow: still 1
    frame();
    expect(receiving(meshes)).toBe(PER * 3);
  });

  it('the next batch waits until the last one is ready (shaders made in the background), sized by the slowest frame meanwhile', () => {
    const { meshes, sw, frame, settle, setFrameMs, setReady } = setup(400);
    for (let i = 0; i < 5; i++) frame(); // the usual frame: 16 ms
    sw.set(false);
    setReady(false);
    frame(); // 1 material, its shaders not made yet
    expect(receiving(meshes)).toBe(360 - PER);
    frame(); // quick (the batch isn't drawn yet): no new batch
    setFrameMs(400);
    frame(); // the cost comes now: still waiting
    expect(receiving(meshes)).toBe(360 - PER);
    expect(sw.busy).toBe(true);
    setFrameMs(16);
    setReady(true);
    frame(); // ready: the slowest frame (400 ms) keeps the batch at 1 (halved, at least 1)
    expect(receiving(meshes)).toBe(360 - PER * 2);
    frame(); // quick and ready: 2
    expect(receiving(meshes)).toBe(360 - PER * 4);
    setReady(false); // a shader that never compiles: the switch goes on after WAIT_FRAMES
    for (let i = 0; i < WAIT_FRAMES; i++) frame();
    expect(receiving(meshes)).toBeLessThan(360 - PER * 4);
    setReady(true);
    settle(400);
    expect(sw.busy).toBe(false);
    expect(receiving(meshes)).toBe(0);
  });

  it('a mesh disposed during a switch is skipped', () => {
    const { meshes, sw, settle } = setup();
    sw.set(false);
    meshes[55].dispose();
    settle();
    expect(sw.busy).toBe(false);
    expect(sw.heldCount).toBe(89);
  });
});
