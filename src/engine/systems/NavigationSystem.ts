/**
 * NavigationSystem.ts
 *
 * Search, show and go to places: `engine.navigation` (v0.13.3 search, v0.13.4
 * "Show route" / "Take me there"; private-docs/NAVIGATION_PLAN.md 4.4 to 4.7).
 *
 *   engine.navigation.find('Kavya')   → [{ id, kind, name, detail, floorId, … }]  (People, Rooms, Facilities)
 *   engine.navigation.show(id)        → from above: its floor, the camera flies to it, it is outlined;
 *                                       walking: it is outlined and the walk to it is measured
 *   engine.navigation.routeTo(target, { walk: 'guide' | 'auto' })
 *                                     → walking there (from above: walking starts at the entrance):
 *                                       'guide' = Show route (a line on the floor, you walk),
 *                                       'auto' = Take me there (your character walks it)
 *   engine.navigation.stop()          → the route ends
 *   engine.navigation.browse()        → the Find box's menu while it is empty (v0.14.2): facility chips, My desk,
 *                                       departments, places by kind, by floor (play/navigation/browse.js)
 *   engine.on('navigation', (e) => …) → { state: 'started' | 'progress' | 'arrived' | 'stopped' | 'failed', … }
 *   engine.navigation.tourPlan()      → the company tour's plan (v0.14.4: planned in idle time after the walk maps,
 *                                       kept until the layout, the people or the departments change)
 *
 * The index (play/navigation/places.js, pure) is made again when the layout's
 * rooms, items or floors, or the people (setPeople), change. The walk maps are
 * one cache (walkMaps), shared with the walkthrough's controller, and built in
 * idle time after a layout loads (warm()), so the first route doesn't freeze.
 * Following a route is play/navigation/follow.js (pure); the character moves
 * through the walkthrough's own collisions (playController.setAutopilot).
 */

import { ASSET_TYPES } from '../../utils/assetCatalog';
import { buildPlaces, searchPlaces, publicPlace, flatResults, FACILITIES } from '../../play/navigation/places';
import { browsePlaces, recentPlaces } from '../../play/navigation/browse';
import { planTour } from '../../play/navigation/tour';
import { findNearestRoute, roomAt } from '../../play/navigation/route';
import { createWalkMapCache } from '../../play/navigation/walkMap';
import { entranceSpawn } from '../../play/navigation/entrance';
import { createFollower, routeMarks, headingOf, turnTowards, TURN_RATE } from '../../play/navigation/follow';
import { supportHeight, elevationOf, floorsInOrder } from '../../play/building';

/** What search results look like to the page (places.publicPlace). */
export interface PlaceResult {
  id: string;
  kind: 'person' | 'room' | 'department' | 'facility' | 'nearest' | 'spot';
  group: 'people' | 'rooms' | 'facilities';
  name: string;
  /** e.g. "Engineering · Floor 1, Engineering 2" */
  detail: string;
  floorId: number;
  floorName: string;
  roomId: string | null;
  roomName: string;
  department: string | null;
  /** 'RESTROOM' | 'MEETING' | 'RECEPTION' | 'STAIRS' */
  facility: string | null;
  personId?: string;
  deskId?: string;
  /** The room or item the camera flies to (focusOn); null for "Nearest washroom". */
  entityId: string | null;
  /** "Nearest …": the places it chooses from. */
  places?: string[];
}

export interface SearchGroups {
  query: string;
  groups: { people: PlaceResult[]; rooms: PlaceResult[]; facilities: PlaceResult[] };
  /** How many more each group has than it shows. */
  more: { people: number; rooms: number; facilities: number };
  total: number;
  /** The groups in the order shown: People, Rooms, Facilities; Rooms first when a room or department name matches better than any person's. */
  order: ('people' | 'rooms' | 'facilities')[];
}

/** A department you can give a description to (LayoutEngine.setDepartments; AHDUS: GET /api/teams/departments). */
export interface DepartmentInfo {
  name: string;
  description?: string;
}

type Spot = { x: number; z: number; floor: number };

/** One stop of the tour (planTour()). */
export interface TourStop {
  id: string;
  n: number;
  kind: 'entrance' | 'reception' | 'department' | 'facility' | 'return';
  facility: 'RESTROOM' | 'MEETING' | null;
  name: string;
  floor: number;
  floorName: string;
  roomId: string | null;
  rooms: { id: string; name: string }[];
  department: string | null;
  description: string | null;
  spot: Spot;
  yaw: number;
  look: { x: number; z: number } | null;
  people: number;
  /** How long the tour stays here (s): a department or the reception 20, a washroom, a meeting room or the entrance 8, the end 0. */
  pause: number;
  names: { name: string; department: string | null }[];
  lines: string[];
  text: string;
  leg: {
    legs: { floor: number; points: { x: number; z: number }[]; stairsAtEnd?: { kind: string; objectId: string; direction: 'up' | 'down'; toFloor: number; length: number } }[];
    length: number;
    seconds: number;
    directions: string;
    steps: { text: string; floor: number; at: { x: number; z: number }; along: number }[];
    mentions: TourMention[];
    problem?: string;
    message?: string;
  } | null;
}

/** "On your left: Restrooms" at a point of a leg (a room passed within 4 m of its door). */
export interface TourMention {
  roomId: string;
  name: string;
  side: 'left' | 'right' | 'ahead' | 'behind';
  text: string;
  at: Spot;
  door: { x: number; z: number };
  distance: number;
  along: number;
  stop?: number;
}

/** The company tour's plan (planTour(), play/navigation/tour.js). */
export interface TourPlan {
  stops: TourStop[];
  floors: number[];
  length: number;
  seconds: number;
  walkSeconds: number;
  pauseSeconds: number;
  minutes: number;
  mentions: (TourMention & { stop: number })[];
  skipped: { roomId: string; name: string; floor: number; floorName: string; kind: string; problem: string; message: string }[];
  missed: { roomId: string; name: string; floor: number }[];
  ms: number;
}

/** The Find box's browse menu (browse()): only what this workplace has. */
export interface BrowseMenu {
  /** The facility kinds that exist. Walking: the nearest one and the walk to it ("Nearest washroom · 8 m"). */
  chips: {
    facility: string; label: string; count: number; kind: string;
    /** The only one of its kind (a pick shows it at once). */
    place: PlaceResult | null;
    /** Walking: "Nearest washroom" ('nearest:RESTROOM') and how far it is by walking; null from above or with no route. */
    nearest: { place: PlaceResult; length: number; seconds: number } | null;
  }[];
  /** The signed-in person's seat (setPlayer's personId), if they have one. */
  myDesk: PlaceResult | null;
  /** The recent searches (browse({ recent }): place ids, newest first) that still exist. */
  recent: PlaceResult[];
  /** "Engineering · 2 rooms · Floor 1 · 92 people", by name. */
  departments: {
    id: string; name: string; description: string | null; detail: string;
    /** What a pick of the whole department shows (its rooms outlined; one room: that room); null: people only. */
    place: PlaceResult | null;
    rooms: PlaceResult[]; people: PlaceResult[];
  }[];
  /** Offices, Meeting rooms, Washrooms, Reception, Stairs, then other room types: each with its places by floor. */
  kinds: { id: string; key: string; name: string; count: number; detail: string; floors: { floorId: number; floorName: string; places: PlaceResult[] }[] }[];
  /** "Ground Floor · 13 rooms" → its rooms. */
  floors: { id: string; floorId: number; name: string; count: number; detail: string; places: PlaceResult[] }[];
}

/** What show() did: the place shown and, walking, how far it is (or why you can't walk there). */
export interface ShowResult {
  place: PlaceResult;
  /** Walking: the walk there (metres, seconds at walking speed, the floors on the way). */
  route?: { length: number; seconds: number; floors: number[] };
  problem?: string;
  message?: string;
}

/** Where routeTo can go: a result (or its id), a person, a desk, a room, an item, a kind of place, a spot. */
export type RouteTarget =
  | string
  | { id: string }
  | { personId: string }
  | { deskId: string }
  | { roomId: string }
  | { objectId: string }
  | { type: 'RESTROOM' | 'MEETING' | 'RECEPTION' | 'STAIRS' }
  | { x: number; z: number; floor?: number; name?: string };

export type WalkMode = 'guide' | 'auto';

/** routeTo's answer: the walk started (where to, how far), or why it can't. */
export interface RouteAnswer {
  place?: PlaceResult;
  walk?: WalkMode;
  length?: number;
  seconds?: number;
  floors?: number[];
  problem?: string;
  message?: string;
}

/** The 'navigation' event. */
export interface NavigationEvent {
  state: 'started' | 'progress' | 'arrived' | 'stopped' | 'failed';
  /** 'guide' (Show route) or 'auto' (Take me there). */
  walk: WalkMode;
  place: PlaceResult;
  /** Metres left. */
  remaining?: number;
  /** The whole route (started; progress after a new route). */
  length?: number;
  seconds?: number;
  /** The floor you are on. */
  floor?: number;
  /** Take me there was paused by a movement key ("Press G to continue"). */
  paused?: boolean;
  /** A new route was made (you left the old one, or it was stuck). */
  rerouted?: boolean;
  problem?: string;
  message?: string;
  /** 'click': a click on the floor started it (v0.14.0); none: search, the page (routeTo / goTo). */
  source?: RouteSource;
}

/**
 * Who started a route. 'click' (a click on the floor while walking, v0.14.0): it touches no outline,
 * a movement key ends it (no "Press G"), and it stops on arrival without turning. 'tour' (the company
 * tour, v0.14.4: TourSystem): it touches no outline either (the tour outlines its stops), pauses like
 * Take me there, and on arrival turns to the way the stop faces (routeTo's `face`).
 */
export type RouteSource = 'click' | 'tour';

/** routeTo's `face`: on arrival, turn to this yaw (and pitch); turn: false = at once (prefers-reduced-motion). */
export interface FaceOnArrival { yaw: number; pitch?: number; turn?: boolean }
/** The tour's walks arrive this close to their spot (m), not within the usual 1 m: a stop stands well inside its room. */
export const TOUR_ARRIVE_WITHIN = 0.35;

/** A walker's controller (playController via WalkthroughSystem): what navigation drives. */
export interface PilotHost {
  setAutopilot(pilot: Pilot | null): void;
}

export interface PilotFrame { x: number; z: number; y: number; floor: number; yaw: number; userMoving: boolean; flying: boolean }
export interface Pilot {
  drive(dt: number, me: PilotFrame): { dirX: number; dirZ: number; speed: number; yaw?: number; pitch?: number } | null;
  key(code: string): boolean;
}

export interface RouteLine {
  show(chevrons: { x: number; y: number; z: number; yaw?: number }[], markers: { kind: 'stairs' | 'goal'; x: number; y: number; z: number }[]): void;
  hide(): void;
}

interface Hooks {
  getLayout: () => { rooms: object; objects: object; floors: Record<number, { id: number; name: string; height?: number }>; currentFloor: number };
  /** Walking: where you stand; null from above. */
  getWalker: () => { x: number; z: number; floor: number } | null;
  focusOn: (entityId: string, options: { animate: boolean; around?: number; beta?: number }) => boolean;
  highlight: (ids: string[], color: string) => void;
  clearHighlights: () => void;
  /** Start walking (from above: at the entrance); the controller to drive, or null if walking can't start. */
  startWalking?: () => PilotHost | null;
  /** The route line (RouteLineSystem). */
  routeLine?: () => RouteLine | null;
  emit?: (event: NavigationEvent) => void;
  /** The signed-in person (setPlayer's personId): "My desk". */
  getMe?: () => string | null;
  /** When idle work runs (default requestIdleCallback, else a short timeout); tests pass their own. */
  idle?: (fn: () => void) => void;
}

/** The outline of a place found. */
export const SEARCH_HIGHLIGHT = '#2fbf71';
/** Showing a person or an item: this far around it (m), looking down at most this far from straight down (rad). */
export const SHOW_AROUND = 4;
export const SHOW_BETA = 0.75;
/** At most two new routes a second (NAVIGATION_PLAN 4.8). */
export const REROUTE_EVERY = 0.5;
/** Stuck this many times (with no real progress between): "Can't get past here". */
export const STUCK_LIMIT = 2;
/** Progress since the last time it was stuck that forgives it (m). */
const STUCK_FORGIVEN_AFTER = 3;
export const CANT_GET_PAST = "Can't get past here";
/** The route line: redrawn after this much progress (m). */
const REDRAW_EVERY = 0.5;
/** A 'progress' event: after this much progress (m), or this long (s). */
const PROGRESS_EVERY_M = 1;
const PROGRESS_EVERY_S = 1;
/** Arrived: facing the person or room, looking a little down. */
const ARRIVE_PITCH = -0.18;

// places.js is plain JS: its places are read as loose records here
type Place = Record<string, any>;
type Index = { places: Place[]; byId: Map<string, Place>; floors: { id: number; name: string }[] };
type Route = {
  problem?: string; message?: string; length: number; seconds: number;
  legs: { floor: number; points: { x: number; z: number }[] }[]; goalIndex?: number;
};

interface Walk {
  place: Place;
  walk: WalkMode;
  host: PilotHost;
  route: Route;
  follower: ReturnType<typeof createFollower>;
  paused: boolean;
  stuck: number;
  stuckAtS: number;
  sinceReroute: number;
  drawnS: number;
  drawnFloor: number;
  emittedRemaining: number;
  sinceEmit: number;
  /** Arrived: turning to face it, then done. */
  faceYaw: number | null;
  /** routeTo's face (the tour's stops). */
  face?: FaceOnArrival;
  /** Walking time so far (s, the frames' time). */
  elapsed: number;
  source?: RouteSource;
}

const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? v : Object.values((v ?? {}) as Record<string, T>));

export class NavigationSystem {
  private hooks: Hooks;
  private people: { personId: string; deskId: string; name?: string; department?: string }[] = [];
  private departments: DepartmentInfo[] = [];
  private index: Index | null = null;
  private indexKey: unknown[] = [];
  /** The walk maps (one per floor), shared with the walkthrough's controller (playController's walkMaps option). */
  readonly walkMaps = createWalkMapCache({ catalog: ASSET_TYPES });
  private shown: string | null = null;
  private active: Walk | null = null;
  private warmToken = 0;
  /** The tour's plan, kept while its inputs are the same (tourPlan()). */
  private tour: { plan: TourPlan; key: unknown[] } | null = null;

  constructor(hooks: Hooks) {
    this.hooks = hooks;
  }

  /** Who sits where (LayoutEngine.setPeople): only personId, deskId, name and department are kept. */
  setPeople(people: { personId: string | number; deskId: string | number; name?: unknown; department?: unknown }[]): void {
    this.people = (Array.isArray(people) ? people : []).map((p) => ({
      personId: String(p?.personId ?? ''), deskId: String(p?.deskId ?? ''),
      name: typeof p?.name === 'string' ? p.name : undefined,
      department: typeof p?.department === 'string' ? p.department : undefined,
    })).filter((p) => p.personId && p.deskId);
    this.index = null;
  }

  /**
   * Descriptions of departments (replaces the list before): [{ name, description }]. Shown in the
   * Find box's menu under a department of that name that exists here (rooms' departmentRef or
   * people's departments); text only, at most 280 characters.
   */
  setDepartments(departments: { name?: unknown; description?: unknown }[] | null | undefined): void {
    this.departments = (Array.isArray(departments) ? departments : [])
      .filter((d) => d && typeof d.name === 'string')
      .map((d) => ({ name: d.name as string, ...(typeof d.description === 'string' ? { description: d.description } : {}) }));
    this.tour = null; // the tour's texts have the descriptions
  }

  /**
   * The Find box's menu while it is empty (v0.14.2): the facility chips that exist (walking: the
   * nearest one and the walk there), My desk, the recent searches (`recent`: place ids, newest
   * first) that still exist, departments, places by kind and by floor. Built from the same index
   * as search, so only what this workplace has.
   */
  browse({ recent = [] }: { recent?: string[] } = {}): BrowseMenu {
    const index = this.places();
    const menu = browsePlaces(index, { departments: this.departments, me: this.hooks.getMe?.() ?? null });
    const pub = (p: Place | null | undefined) => (p ? (publicPlace(p) as PlaceResult) : null);
    const pubs = (list: Place[]) => list.map((p) => publicPlace(p) as PlaceResult);
    const walker = this.hooks.getWalker();
    return {
      chips: menu.chips.map((c: Place) => {
        let nearest: BrowseMenu['chips'][number]['nearest'] = null;
        if (walker) {
          const place = this.place(`nearest:${c.facility}`);
          const route = place ? this.routeFrom(walker, place) : null;
          if (place && route && !route.problem) nearest = { place: publicPlace(place) as PlaceResult, length: route.length, seconds: route.seconds };
        }
        return { facility: c.facility, label: c.label, count: c.count, kind: c.kind, place: pub(c.only), nearest };
      }),
      myDesk: pub(menu.myDesk),
      recent: pubs(recentPlaces(index, recent)),
      departments: menu.departments.map((d: Place) => ({
        id: d.id, name: d.name, description: d.description, detail: d.detail, place: pub(d.place), rooms: pubs(d.rooms), people: pubs(d.people),
      })),
      kinds: menu.kinds.map((k: Place) => ({
        id: k.id, key: k.key, name: k.name, count: k.count, detail: k.detail,
        floors: k.floors.map((g: Place) => ({ floorId: g.floor, floorName: g.floorName, places: pubs(g.places) })),
      })),
      floors: menu.floors.map((f: Place) => ({ id: f.id, floorId: f.floor, name: f.name, count: f.count, detail: f.detail, places: pubs(f.places) })),
    };
  }

  /**
   * The company tour's plan (v0.14.3, play/navigation/tour.js): the stops in walking order, from the
   * layout, the seats (setPeople) and the departments' descriptions (setDepartments), on the shared
   * walk maps. Read-only: nothing walks yet (the tour itself is v0.14.4). Options as planTour's
   * (speed, pause, backToReception).
   */
  planTour(options: { speed?: number; pause?: number; facilityPause?: number; backToReception?: boolean } = {}): TourPlan {
    const s = this.hooks.getLayout();
    return planTour(s, this.people, this.departments, { ...options, maps: this.walkMaps, catalog: ASSET_TYPES }) as TourPlan;
  }

  /**
   * The tour's plan with the default options (v0.14.4, the tour itself: TourSystem): planned in idle time
   * after the walk maps (warm()), so "Start the tour" never waits; planned now if it isn't ready (or the
   * layout, the people or the departments changed since).
   */
  tourPlan(): TourPlan {
    const key = this.tourKey();
    if (!this.tour || key.some((k, i) => k !== this.tour!.key[i])) this.tour = { plan: this.planTour(), key };
    return this.tour.plan;
  }

  /** The tour's plan if it is planned already for the layout now, else null (nothing is planned). */
  get tourPlanReady(): TourPlan | null {
    const key = this.tourKey();
    return this.tour && key.every((k, i) => k === this.tour!.key[i]) ? this.tour.plan : null;
  }

  private tourKey(): unknown[] {
    const s = this.hooks.getLayout();
    return [s.rooms, s.objects, s.floors, this.people, this.departments];
  }

  /** The index, made again when the layout or the people changed. */
  places(): Index {
    const s = this.hooks.getLayout();
    const key = [s.rooms, s.objects, s.floors, this.people];
    if (!this.index || key.some((k, i) => k !== this.indexKey[i])) {
      this.index = buildPlaces(s, this.people) as Index;
      this.indexKey = key;
    }
    return this.index;
  }

  /**
   * Build the walk maps of every floor (and warm up the route finder) in idle time, one floor at a
   * time: after a layout loads, so the first route or "Take me there" doesn't freeze the page. A
   * changed layout (or warm() again) drops a warm-up that hasn't finished. Resolves when done.
   */
  warm(): Promise<void> {
    const token = ++this.warmToken;
    const idle = this.hooks.idle ?? defaultIdle;
    const s = this.hooks.getLayout();
    const steps: (() => void)[] = floorsInOrder(s.floors).map((f: { id: number }) => () => { this.walkMaps.get(s, f.id); });
    // one route (the entrance → the first place), so the route finder's own parts are made too
    steps.push(() => {
      const spawn = entranceSpawn(s, { maps: this.walkMaps });
      const goal = this.places().places.find((p) => p.goals?.length)?.goals[0];
      if (goal) findNearestRoute(s, { x: spawn.x, z: spawn.z, floor: spawn.floor }, [goal], { maps: this.walkMaps });
    });
    // then the tour's plan (v0.14.4): "Start the tour" never waits for it
    steps.push(() => { this.tourPlan(); });
    return new Promise((resolve) => {
      const next = () => {
        const now = this.hooks.getLayout();
        if (token !== this.warmToken || now.rooms !== s.rooms || now.objects !== s.objects || now.floors !== s.floors) {
          resolve();
          return;
        }
        const step = steps.shift();
        if (!step) { resolve(); return; }
        try { step(); } catch (e) { console.warn('[navigation] warming up the walk maps failed', e); }
        idle(next);
      };
      idle(next);
    });
  }

  /** Where you are, for "nearest first": walking, your spot; from above, the floor shown. */
  private from() {
    return this.hooks.getWalker() ?? { floor: this.hooks.getLayout().currentFloor };
  }

  /** Search, grouped as the search box shows it (People, Rooms, Facilities; `limit` per group). */
  search(query: string, { limit }: { limit?: number } = {}): SearchGroups {
    const r = searchPlaces(this.places(), String(query ?? ''), { from: this.from(), limit });
    const pub = (items: Place[]) => items.map((p) => publicPlace(p) as PlaceResult);
    return {
      query: r.query,
      groups: { people: pub(r.groups.people), rooms: pub(r.groups.rooms), facilities: pub(r.groups.facilities) },
      more: { ...r.more },
      total: r.total,
      order: [...r.order] as SearchGroups['order'],
    };
  }

  /** Search: every result in the order shown (People, Rooms, Facilities; Rooms first for "Engineering"), `limit` per group (default 6). */
  find(query: string, options: { limit?: number } = {}): PlaceResult[] {
    const r = searchPlaces(this.places(), String(query ?? ''), { from: this.from(), limit: options.limit });
    return flatResults(r).map((p: Place) => publicPlace(p) as PlaceResult);
  }

  /** A place by its id ('person:…', 'room:…', 'department:…', 'item:…', 'nearest:RESTROOM'). */
  private place(id: string): Place | null {
    const index = this.places();
    const found = index.byId.get(id);
    if (found) return found as Place;
    const facility = id.startsWith('nearest:') ? id.slice(8) : '';
    if (!Object.hasOwn(FACILITIES, facility)) return null;
    const walker = this.hooks.getWalker();
    const r = searchPlaces(index, FACILITIES[facility as keyof typeof FACILITIES].words[0], { from: walker ?? { x: 0, z: 0, floor: 0 } });
    return (r.groups.facilities.find((p: Place) => p.id === id) as Place) ?? null;
  }

  /** routeTo's targets → a place (with the goals to walk to); null: no such place. */
  private resolve(target: RouteTarget): Place | null {
    if (typeof target === 'string') return this.place(target);
    if (!target || typeof target !== 'object') return null;
    const t = target as Record<string, unknown>;
    if (typeof t.id === 'string') return this.place(t.id);
    if (t.personId != null) return this.place(`person:${t.personId}`);
    if (t.roomId != null) return this.place(`room:${t.roomId}`);
    if (typeof t.type === 'string') return this.place(`nearest:${t.type.toUpperCase()}`);
    const s = this.hooks.getLayout();
    const objectId = t.deskId ?? t.objectId;
    if (objectId != null) {
      const id = String(objectId);
      const person = this.places().places.find((p) => p.kind === 'person' && p.deskId === id);
      if (person) return person;
      const item = this.place(`item:${id}`);
      if (item) return item;
      const o = (s.objects as Record<string, Place>)[id];
      if (!o) return null;
      const label = o.label || ASSET_TYPES[o.assetType as keyof typeof ASSET_TYPES]?.label || 'Item';
      return this.spot(o.x, o.z, o.floor ?? 0, label, { id: `object:${id}`, entityId: id, highlight: [id] });
    }
    if (Number.isFinite(t.x) && Number.isFinite(t.z)) {
      const floor = Number.isFinite(t.floor) ? (t.floor as number) : (this.hooks.getWalker()?.floor ?? s.currentFloor);
      return this.spot(t.x as number, t.z as number, floor, typeof t.name === 'string' ? t.name : null);
    }
    return null;
  }

  /** A place made for a spot (or an item that isn't in the index). */
  private spot(x: number, z: number, floor: number, name: string | null, more: Partial<Place> = {}): Place {
    const s = this.hooks.getLayout();
    const room = roomAt(s, floor, x, z) as Place | null;
    const floorName = s.floors[floor]?.name || `Floor ${floor}`;
    return {
      id: `spot:${x.toFixed(2)},${z.toFixed(2)},${floor}`, kind: 'spot', group: 'rooms', name: name ?? room?.name ?? 'This spot',
      detail: room ? `${floorName}, ${room.name}` : floorName, floor, floorName, roomId: room?.id ?? null, roomName: room?.name ?? '',
      department: null, facility: null, entityId: null, highlight: [], x, z, goals: [{ x, z, floor }], ...more,
    };
  }

  /**
   * Show a place (an id from find(), or a result): from above, its floor, the
   * camera flies to it and it is outlined; walking, it is outlined and the
   * walk to it from where you stand is measured ("Nearest washroom": the
   * nearest by walking). null: no such place. target: as routeTo's (v0.14.6: { personId }, { roomId }, … too).
   */
  show(target: RouteTarget, { animate = true, color = SEARCH_HIGHLIGHT } = {}): ShowResult | null {
    let place = this.resolve(target);
    if (!place) return null;
    const walker = this.hooks.getWalker();
    const out: Partial<ShowResult> = {};

    if (walker) {
      const route = this.routeFrom(walker, place);
      if (route.problem) {
        out.problem = route.problem;
        out.message = route.message;
      } else {
        out.route = { length: route.length, seconds: route.seconds, floors: route.legs.map((l) => l.floor) };
        place = this.chosen(place, route);
      }
    } else if (place.kind === 'nearest') {
      // from above there is no "where you stand": the first one (the floor shown first)
      place = this.places().byId.get(place.places[0]) as Place;
    }

    this.hooks.clearHighlights();
    if (place.highlight.length) this.hooks.highlight(place.highlight, color);
    if (!walker && place.entityId) {
      const item = place.kind === 'person' || place.id.startsWith('item:');
      this.hooks.focusOn(place.entityId, { animate, beta: SHOW_BETA, ...(item ? { around: SHOW_AROUND } : {}) });
    }
    this.shown = place.id;
    return { place: publicPlace(place) as PlaceResult, ...out };
  }

  /** The route from a spot to a place (the nearest of its goals by walking), each goal named after its own place. */
  private routeFrom(from: { x: number; z: number; floor: number }, place: Place): Route {
    // a person: "No walking route to Dhruv Khatwani's desk: …"
    const own = place.kind === 'person' ? `${place.name}'s desk` : place.name;
    const goals = place.goals.map((g: { x: number; z: number; floor: number; placeId?: string }) => ({
      ...g, name: (g.placeId && this.places().byId.get(g.placeId)?.name) || own,
    }));
    return findNearestRoute(this.hooks.getLayout(), from, goals, { maps: this.walkMaps }) as unknown as Route;
  }

  /** "Nearest washroom": the one the route goes to. */
  private chosen(place: Place, route: Route): Place {
    if (place.kind !== 'nearest' || route.goalIndex === undefined) return place;
    const id = place.goals[route.goalIndex]?.placeId;
    return (id && this.places().byId.get(id)) || place;
  }

  /** The place shown now (its id), or null. */
  get current(): string | null {
    return this.shown;
  }

  /** Take the outline away (the camera stays). A route being followed ends too. */
  clear(): void {
    if (this.active) this.stop();
    if (this.shown === null) return;
    this.shown = null;
    this.hooks.clearHighlights();
  }

  // ── Going there (v0.13.4) ──────────────────────────────────────────────

  /** The route being followed now, or null: { place, walk, paused, remaining, elapsed }. */
  get walking(): { place: PlaceResult; walk: WalkMode; paused: boolean; remaining: number; elapsed: number; source?: RouteSource } | null {
    const w = this.active;
    if (!w) return null;
    return {
      place: publicPlace(w.place) as PlaceResult, walk: w.walk, paused: w.paused,
      remaining: Math.max(0, w.follower.length - w.follower.progress), elapsed: w.elapsed,
      ...(w.source ? { source: w.source } : {}),
    };
  }

  /**
   * Go to a place: 'guide' (Show route: the line on the floor, you walk) or 'auto' (Take me there:
   * your character walks it, through the same collisions as your keys; a movement key pauses it,
   * G continues, Esc or stop() ends it). From above, walking starts at the entrance.
   * target: an id or result from find(), { personId } | { deskId } | { roomId } | { objectId } |
   * { type: 'RESTROOM' | 'MEETING' | 'RECEPTION' | 'STAIRS' } (the nearest) | { x, z, floor }.
   */
  routeTo(target: RouteTarget, { walk = 'guide', source, face }: { walk?: WalkMode; source?: RouteSource; face?: FaceOnArrival } = {}): RouteAnswer {
    const mode: WalkMode = walk === 'auto' ? 'auto' : 'guide';
    const from = source === 'click' || source === 'tour' ? { source } : {};
    if (!this.resolve(target)) return { problem: 'NOT_FOUND', message: 'Nothing found to go to' };
    if (this.active) this.end('stopped', { silent: true });
    const host = this.hooks.startWalking?.() ?? null;
    const walker = this.hooks.getWalker();
    if (!host || !walker) return { problem: 'NOT_WALKING', message: 'Walking is not possible here' };
    // resolved again now that you are walking ("the nearest washroom" is the nearest to where you stand)
    let place = this.resolve(target)!;
    const route = this.routeFrom(walker, place);
    if (route.problem) {
      const message = route.message ?? 'No walking route';
      this.hooks.emit?.({ state: 'failed', walk: mode, place: publicPlace(place) as PlaceResult, problem: route.problem, message, floor: walker.floor, ...from });
      return { place: publicPlace(place) as PlaceResult, problem: route.problem, message };
    }
    place = this.chosen(place, route);
    const w: Walk = {
      place, walk: mode, host, route, follower: this.follower(route, source), paused: false, stuck: 0, stuckAtS: 0,
      sinceReroute: 0, drawnS: -Infinity, drawnFloor: -1, emittedRemaining: route.length, sinceEmit: 0, faceYaw: null, elapsed: 0,
      ...from, ...(face && Number.isFinite(face.yaw) ? { face } : {}),
    };
    this.active = w;
    if (!w.source) { // a click's walk leaves what search outlined alone
      this.hooks.clearHighlights();
      if (place.highlight?.length) this.hooks.highlight(place.highlight, SEARCH_HIGHLIGHT);
      this.shown = place.id;
    }
    host.setAutopilot(this.pilot(w));
    this.draw(w, walker.floor, true);
    const floors = route.legs.map((l) => l.floor);
    this.hooks.emit?.({
      state: 'started', walk: mode, place: publicPlace(place) as PlaceResult, length: route.length, remaining: route.length,
      seconds: route.seconds, floor: walker.floor, ...from,
    });
    return { place: publicPlace(place) as PlaceResult, walk: mode, length: route.length, seconds: route.seconds, floors };
  }

  /** End the route (Stop, Esc): the line goes, the character stops (your keys again). */
  stop(): boolean {
    if (!this.active) return false;
    this.end('stopped');
    return true;
  }

  /**
   * Pause Take me there (the tour's Pause, P): the character stops where it is, the line stays; resume()
   * walks on. false: no route, or it is paused already.
   */
  pause(): boolean {
    const w = this.active;
    if (!w || w.paused || w.faceYaw !== null) return false;
    w.paused = true;
    this.emitProgress(w, this.hooks.getWalker()?.floor, { force: true });
    return true;
  }

  /**
   * The way the route is followed, switched while it is followed (the tour's "Walk me" / "I'll walk"):
   * 'auto' = as resume(); 'guide' = the line only, you walk. false: no route.
   */
  setWalk(walk: WalkMode): boolean {
    const w = this.active;
    if (!w || w.faceYaw !== null) return false;
    if (walk === 'auto') return w.walk === 'auto' && !w.paused ? true : this.resume();
    w.walk = 'guide';
    w.paused = false;
    this.emitProgress(w, this.hooks.getWalker()?.floor, { force: true });
    return true;
  }

  /** Take me there again after a movement key paused it (G, "Continue"); also Show route → Take me there. */
  resume(): boolean {
    const w = this.active;
    if (!w || w.faceYaw !== null) return false;
    w.walk = 'auto';
    w.paused = false;
    w.stuck = 0;
    w.follower.resetStuck();
    // walked off it meanwhile: a new route from where you are
    const me = this.hooks.getWalker();
    if (me && w.follower.step({ x: me.x, z: me.z, floor: me.floor, yaw: 0 }, 0, { drive: false }).offBy > 1) {
      return this.reroute(w);
    }
    this.emitProgress(w, me?.floor, { force: true });
    return true;
  }

  private follower(route: Route, source?: RouteSource) {
    const layout = this.hooks.getLayout();
    // arrived = within 1 m AND in the room the route ends in (a room's goal is just inside its door)
    const legs = (route as { legs: { floor: number; points: { x: number; z: number }[] }[] }).legs;
    const last = legs[legs.length - 1];
    const endAt = last?.points[last.points.length - 1];
    const goalRoom = endAt ? roomAt(layout, last.floor, endAt.x, endAt.z) : null;
    const inGoalRoom = (me: { x: number; z: number; floor: number }) => !goalRoom || roomAt(layout, me.floor, me.x, me.z)?.id === goalRoom.id;
    return createFollower(route as never, {
      mapFor: (f: number) => this.walkMaps.get(this.hooks.getLayout(), f), inGoalRoom,
      ...(source === 'tour' ? { arriveWithin: TOUR_ARRIVE_WITHIN } : {}),
    });
  }

  /** A new route from where you are to the same place; false: none (the walk failed). */
  private reroute(w: Walk): boolean {
    const me = this.hooks.getWalker();
    if (!me) return false;
    const route = this.routeFrom(me, w.place); // "the nearest …": again the nearest from here
    w.sinceReroute = 0;
    if (route.problem) {
      this.end('failed', { problem: route.problem, message: route.message ?? CANT_GET_PAST });
      return false;
    }
    w.route = route;
    w.follower = this.follower(route, w.source);
    w.drawnS = -Infinity;
    this.draw(w, me.floor, true);
    this.emitProgress(w, me.floor, { force: true, rerouted: true });
    return true;
  }

  private end(state: 'arrived' | 'stopped' | 'failed', { problem, message, silent = false }: { problem?: string; message?: string; silent?: boolean } = {}): void {
    const w = this.active;
    if (!w) return;
    this.active = null;
    w.host.setAutopilot(null);
    this.hooks.routeLine?.()?.hide();
    if (state !== 'arrived' && !w.source) { // arrived: the place stays outlined; a click's walk outlined nothing
      this.hooks.clearHighlights();
      this.shown = null;
    }
    if (silent) return;
    const me = this.hooks.getWalker();
    this.hooks.emit?.({
      state, walk: w.walk, place: publicPlace(w.place) as PlaceResult, floor: me?.floor,
      ...(state === 'arrived' ? { remaining: 0 } : {}), ...(problem ? { problem } : {}), ...(message ? { message } : {}),
      ...(w.source ? { source: w.source } : {}),
    });
  }

  /** The route line ahead of you on your floor (redrawn as you go). */
  private draw(w: Walk, floor: number, force = false): void {
    const line = this.hooks.routeLine?.();
    if (!line) return;
    const s = w.follower.progress;
    if (!force && floor === w.drawnFloor && Math.abs(s - w.drawnS) < REDRAW_EVERY) return;
    w.drawnS = s;
    w.drawnFloor = floor;
    const { chevrons, markers } = routeMarks(w.follower.path, s, floor);
    const st = this.hooks.getLayout();
    const rooms = list<Place>(st.rooms);
    const stairs = list<Place>(st.objects).filter((o) => o.assetType === 'STAIRCASE');
    const elev = elevationOf(st.floors, floor);
    const support = (x: number, z: number, from: number) => supportHeight({ x, z, y: from, floors: st.floors, rooms, stairs });
    let up = elev; // on a staircase, from the last chevron's height (the steps climb)
    line.show(
      chevrons.map((c: { x: number; z: number; yaw: number; stairs: boolean }) => {
        const h = support(c.x, c.z, (c.stairs ? up : elev) + 0.5);
        if (c.stairs) up = h;
        return { x: c.x, z: c.z, yaw: c.yaw, y: h + 0.03 };
      }),
      markers.map((m: { kind: string; x: number; z: number }) => ({ kind: m.kind as 'stairs' | 'goal', x: m.x, z: m.z, y: support(m.x, m.z, elev + 0.5) })),
    );
  }

  private emitProgress(w: Walk, floor: number | undefined, { force = false, rerouted = false } = {}): void {
    const remaining = Math.max(0, w.follower.length - w.follower.progress);
    if (!force && Math.abs(remaining - w.emittedRemaining) < PROGRESS_EVERY_M && w.sinceEmit < PROGRESS_EVERY_S) return;
    w.emittedRemaining = remaining;
    w.sinceEmit = 0;
    this.hooks.emit?.({
      state: 'progress', walk: w.walk, place: publicPlace(w.place) as PlaceResult, remaining, length: w.follower.length,
      floor, paused: w.paused, ...(rerouted ? { rerouted } : {}), ...(w.source ? { source: w.source } : {}),
    });
  }

  /** What the walkthrough's controller asks every frame while a route is followed. */
  private pilot(w: Walk): Pilot {
    return {
      key: (code) => {
        if (this.active !== w) return false;
        // Esc ends the route and nothing else (v0.14.0: the view keeps the keys; the next Esc gives them back)
        if (code === 'Escape') { this.stop(); return true; }
        if (code === 'KeyG') return w.walk === 'guide' || w.paused ? this.resume() || true : true;
        return false;
      },
      drive: (dt, me) => {
        if (this.active !== w) return null;
        if (!w.paused) w.elapsed += dt; // the walk's own time (paused time doesn't count)
        w.sinceReroute += dt;
        w.sinceEmit += dt;
        // arrived: turn to face the person or room, then the walk is over
        if (w.faceYaw !== null) {
          const pitch = w.face?.pitch ?? ARRIVE_PITCH;
          if (me.userMoving) { this.end('arrived'); return null; } // you walk on yourself: no turning
          const yaw = turnTowards(me.yaw, w.faceYaw, TURN_RATE * dt);
          if (Math.abs(yaw - w.faceYaw) < 0.02) {
            this.end('arrived');
            return { dirX: 0, dirZ: 0, speed: 0, yaw: w.faceYaw, pitch };
          }
          return { dirX: 0, dirZ: 0, speed: 0, yaw };
        }
        // a movement key ends a click's walk: you walk yourself now
        if (w.source === 'click' && me.userMoving) { this.end('stopped'); return null; }
        // a movement key pauses Take me there ("Press G to continue")
        if (w.walk === 'auto' && !w.paused && me.userMoving) {
          w.paused = true;
          this.emitProgress(w, me.floor, { force: true });
        }
        const driving = w.walk === 'auto' && !w.paused && !me.userMoving;
        const step = w.follower.step({ x: me.x, z: me.z, floor: me.floor, yaw: me.yaw }, dt, { drive: driving });
        if (step.arrived) {
          if (w.source === 'click') { this.end('arrived'); return null; } // there: no turning to face a spot
          const p = w.place;
          const far = Number.isFinite(p.x) && Math.hypot(p.x - me.x, p.z - me.z) > 0.2;
          w.faceYaw = w.face ? w.face.yaw : far ? headingOf(p.x - me.x, p.z - me.z) : me.yaw;
          this.hooks.routeLine?.()?.hide();
          // the tour's stop: turned to the way it faces (also when you walked there yourself), or at once
          if (w.face) {
            if (w.face.turn === false || me.userMoving) {
              this.end('arrived');
              return me.userMoving ? null : { dirX: 0, dirZ: 0, speed: 0, yaw: w.faceYaw, pitch: w.face.pitch ?? ARRIVE_PITCH };
            }
            return { dirX: 0, dirZ: 0, speed: 0, yaw: turnTowards(me.yaw, w.faceYaw, TURN_RATE * dt) };
          }
          if (w.walk === 'guide' || w.paused) { this.end('arrived'); return null; } // you walked there yourself
          return { dirX: 0, dirZ: 0, speed: 0, yaw: turnTowards(me.yaw, w.faceYaw, TURN_RATE * dt) };
        }
        if (step.s - w.stuckAtS > STUCK_FORGIVEN_AFTER) w.stuck = 0;
        if (driving && step.stuck) {
          w.stuck += 1;
          w.stuckAtS = step.s;
          if (w.stuck >= STUCK_LIMIT) {
            this.end('failed', { problem: 'STUCK', message: CANT_GET_PAST });
            return null;
          }
          this.reroute(w);
          return null; // this frame: stand; the next one follows the new route
        }
        if (step.offRoute && w.sinceReroute >= REROUTE_EVERY && !this.reroute(w)) return null;
        this.draw(w, me.floor);
        this.emitProgress(w, me.floor);
        return driving ? { dirX: step.dirX, dirZ: step.dirZ, speed: step.speed, yaw: step.yaw } : null;
      },
    };
  }
}

function defaultIdle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 1000 });
  else setTimeout(fn, 30);
}
