/**
 * integration/demoModules.js
 *
 * FAKE teammate modules, to show (and test) that the layout can be connected to.
 * Open the app with ?demoModules=1 in the address, e.g.
 *
 *   http://localhost:3000/?demoModules=1
 *
 * Each block below is what the real module would do, using only the public
 * layoutBridge API. Teammates can copy their block as a starting point.
 * Nothing here is used without ?demoModules=1.
 */

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';

const DEMO_POSITIONS = [
  { id: 'pos-eng-head', title: 'Engineering Head', department: 'Engineering' },
  { id: 'pos-hr-manager', title: 'HR Manager', department: 'HR' },
  { id: 'pos-prod-supervisor', title: 'Production Supervisor', department: 'Operations' },
  { id: 'pos-backend-dev', title: 'Backend Developer', department: 'Engineering' },
];

const DEMO_HANDOVER = {
  'pos-eng-head': {
    previous: 'Rahul Mehta (left September 2026)',
    done: 'Moved the plant to the new ERP; finished the safety audit',
    pending: 'Vendor contract renewal; hiring two junior engineers',
  },
  'pos-hr-manager': {
    previous: 'Priya Nair (left August 2026)',
    done: 'Rewrote the leave policy; onboarding checklist v2',
    pending: 'Annual appraisal cycle starts in November',
  },
};

/**
 * @param {typeof import('./layoutBridge').layoutBridge} bridge
 * @returns {() => void} uninstall
 */
export function installDemoModules(bridge) {
  const cleanups = [];

  // ── Event log (what Sunil & Kavyashree's monitoring would record) ──
  const log = (window.__ahdusEventLog = []);
  for (const event of ['interact', 'enterRoom', 'exitRoom', 'anchorsChange']) {
    cleanups.push(bridge.on(event, (payload) => {
      log.push({ event, at: Date.now(), payload });
      if (event !== 'anchorsChange') console.info(`[AHDUS event] ${event}`, payload);
    }));
  }

  // ── Karthik (demo): machine videos ──
  cleanups.push(bridge.addInteraction({
    id: 'demo.karthik.machine-video',
    when: (t) => t.anchorKind === 'machine',
    label: (t) => `Watch ${t.object.label} video`,
    run: (t) => bridge.showCard({
      title: `▶ ${t.object.label}: operation video`,
      body: `Karthik's module would play the uploaded video and open the manual for this machine.\n` +
        `It finds them by object ID ${t.objectId}.`,
    }),
  }));

  // ── Yashashwi (demo): org positions + handover notes at the old employee's desk ──
  bridge.setPositionProvider(() => DEMO_POSITIONS);
  cleanups.push(() => bridge.setPositionProvider(null));
  cleanups.push(bridge.addInteraction({
    id: 'demo.yashashwi.handover',
    when: (t) => t.anchorKind === 'workstation' && !!t.positionRef,
    label: 'See handover notes',
    run: (t) => {
      const pos = DEMO_POSITIONS.find((p) => p.id === t.positionRef);
      const notes = DEMO_HANDOVER[t.positionRef];
      bridge.showCard({
        title: `${pos?.title ?? t.positionRef}: handover`,
        body: notes
          ? `Previous: ${notes.previous}\nDone: ${notes.done}\nPending: ${notes.pending}`
          : 'No handover notes for this position yet.',
        duration: 9000,
      });
    },
  }));

  // ── Harsh (demo): a greeter character at every reception desk ──
  const scene = bridge.getScene();
  const skin = new StandardMaterial('demo_greeter_skin', scene);
  skin.diffuseColor = Color3.FromHexString('#c9936b');
  const suit = new StandardMaterial('demo_greeter_suit', scene);
  suit.diffuseColor = Color3.FromHexString('#7a2e3b');
  let greeters = [];

  function placeGreeters() {
    greeters.forEach((g) => g.dispose(false, false));
    greeters = bridge.getAnchors({ kind: 'reception', floorId: bridge.getCurrentFloor().id }).map((a) => {
      const root = new TransformNode(`demo_greeter_${a.id}`, scene);
      // The anchor is on the visitor side, facing the desk. Walk 2 m along that
      // direction (1.2 m to the desk, then 0.8 m past it) to stand behind the
      // desk, and turn around to face the visitor.
      root.position.set(
        a.position.x + Math.sin(a.rotationY) * 2.0,
        a.position.y,
        a.position.z + Math.cos(a.rotationY) * 2.0,
      );
      root.rotation.y = a.rotationY + Math.PI;
      const body = MeshBuilder.CreateCapsule('demo_greeter_body', { height: 1.25, radius: 0.22 }, scene);
      body.position.y = 0.95;
      body.material = suit;
      const head = MeshBuilder.CreateSphere('demo_greeter_head', { diameter: 0.3, segments: 12 }, scene);
      head.position.y = 1.72;
      head.material = skin;
      for (const m of [body, head]) {
        m.parent = root;
        m.isPickable = false;
        m.checkCollisions = false;
      }
      root.metadata = { demoGreeterFor: a.id };
      return root;
    });
  }
  placeGreeters();
  cleanups.push(bridge.on('anchorsChange', placeGreeters));
  cleanups.push(() => {
    greeters.forEach((g) => g.dispose(false, false));
    skin.dispose();
    suit.dispose();
  });

  cleanups.push(bridge.on('enterRoom', ({ room }) => {
    if (room?.type === 'RECEPTION') {
      bridge.showCard({ title: 'HR (demo character)', body: `Welcome to ${room.name}! Walk up to me and press E.`, duration: 4000 });
    }
  }));
  cleanups.push(bridge.addInteraction({
    id: 'demo.harsh.talk',
    when: (t) => t.anchorKind === 'reception',
    label: 'Talk to HR',
    run: (t) => bridge.showCard({
      title: 'HR (demo character)',
      body: `Hi! Harsh's character module would start a conversation here, at ${t.room?.name ?? 'reception'}.`,
    }),
  }));

  console.info('[AHDUS] demo modules installed: Karthik (machine videos), Yashashwi (positions + handover), Harsh (greeter)');
  return () => cleanups.reverse().forEach((fn) => fn());
}
