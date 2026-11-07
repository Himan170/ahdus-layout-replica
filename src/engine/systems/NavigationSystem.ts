/**
 * NavigationSystem.ts
 *
 * Search and show places (v0.13.3, private-docs/NAVIGATION_PLAN.md 4.4 and
 * the "not walking" part of 4.5): `engine.navigation`.
 *
 *   engine.navigation.find('Kavya')   → [{ id, kind, name, detail, floorId, … }]  (People, Rooms, Facilities)
 *   engine.navigation.show(id)        → from above: its floor, the camera flies to it, it is outlined;
 *                                       walking: it is outlined and the walk to it is measured (route.js;
 *                                       "Nearest washroom": findNearestRoute from where you stand)
 *   engine.navigation.clear()         → the outline goes
 *
 * The index (play/navigation/places.js, pure) is made again when the layout's
 * rooms, items or floors, or the people (setPeople), change; a search is a few
 * ms for hundreds of people. Walking there ("Walk there", "Show route") is
 * v0.13.4.
 */

import { ASSET_TYPES } from '../../utils/assetCatalog';
import { buildPlaces, searchPlaces, publicPlace, flatResults, FACILITIES } from '../../play/navigation/places';
import { findNearestRoute } from '../../play/navigation/route';
import { createWalkMapCache } from '../../play/navigation/walkMap';

/** What search results look like to the page (places.publicPlace). */
export interface PlaceResult {
  id: string;
  kind: 'person' | 'room' | 'department' | 'facility' | 'nearest';
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
}

/** What show() did: the place shown and, walking, how far it is (or why you can't walk there). */
export interface ShowResult {
  place: PlaceResult;
  /** Walking: the walk there (metres, seconds at walking speed, the floors on the way). */
  route?: { length: number; seconds: number; floors: number[] };
  problem?: string;
  message?: string;
}

interface Hooks {
  getLayout: () => { rooms: object; objects: object; floors: Record<number, { id: number; name: string }>; currentFloor: number };
  /** Walking: where you stand; null from above. */
  getWalker: () => { x: number; z: number; floor: number } | null;
  focusOn: (entityId: string, options: { animate: boolean; around?: number; beta?: number }) => boolean;
  highlight: (ids: string[], color: string) => void;
  clearHighlights: () => void;
}

/** The outline of a place found. */
export const SEARCH_HIGHLIGHT = '#2fbf71';
/** Showing a person or an item: this far around it (m), looking down at most this far from straight down (rad). */
export const SHOW_AROUND = 4;
export const SHOW_BETA = 0.75;

// places.js is plain JS: its places are read as loose records here
type Place = Record<string, any>;
type Index = { places: Place[]; byId: Map<string, Place> };
/** findNearestRoute's answer: a route (+ goalIndex), or { problem, message }. */
interface RouteAnswer { problem?: string; message?: string; length: number; seconds: number; legs: { floor: number }[]; goalIndex: number }

export class NavigationSystem {
  private hooks: Hooks;
  private people: { personId: string; deskId: string; name?: string; department?: string }[] = [];
  private index: Index | null = null;
  private indexKey: unknown[] = [];
  private maps = createWalkMapCache({ catalog: ASSET_TYPES });
  private shown: string | null = null;

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

  /** Where you are, for "nearest first": walking, your spot; from above, the floor shown. */
  private from() {
    return this.hooks.getWalker() ?? { floor: this.hooks.getLayout().currentFloor };
  }

  /** Search, grouped as the search box shows it (People, Rooms, Facilities; `limit` per group). */
  search(query: string, { limit }: { limit?: number } = {}): SearchGroups {
    const r = searchPlaces(this.places(), String(query ?? ''), { from: this.from(), limit });
    const pub = (list: Place[]) => list.map((p) => publicPlace(p) as PlaceResult);
    return {
      query: r.query,
      groups: { people: pub(r.groups.people), rooms: pub(r.groups.rooms), facilities: pub(r.groups.facilities) },
      more: { ...r.more },
      total: r.total,
    };
  }

  /** Search: every result in the order shown (People, Rooms, Facilities), `limit` per group (default 6). */
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

  /**
   * Show a place (an id from find(), or a result): from above, its floor, the
   * camera flies to it and it is outlined; walking, it is outlined and the
   * walk to it from where you stand is measured ("Nearest washroom": the
   * nearest by walking). null: no such place.
   */
  show(target: string | { id: string }, { animate = true, color = SEARCH_HIGHLIGHT } = {}): ShowResult | null {
    const id = typeof target === 'string' ? target : target?.id;
    let place = id ? this.place(id) : null;
    if (!place) return null;
    const walker = this.hooks.getWalker();
    const out: Partial<ShowResult> = {};

    if (walker) {
      // each goal named after its own place ("No walking route to Restrooms: …", not "…to Nearest washroom")
      const goals = place.goals.map((g: { x: number; z: number; floor: number; placeId?: string }) => ({
        ...g, name: (g.placeId && this.places().byId.get(g.placeId)?.name) || place!.name,
      }));
      const route = findNearestRoute(this.hooks.getLayout(), walker, goals, { maps: this.maps }) as unknown as RouteAnswer;
      if (route.problem) {
        out.problem = route.problem;
        out.message = route.message;
      } else {
        out.route = { length: route.length, seconds: route.seconds, floors: route.legs.map((l) => l.floor) };
        const chosen = goals[route.goalIndex]?.placeId;
        if (place.kind === 'nearest' && chosen) place = this.places().byId.get(chosen) as Place;
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

  /** The place shown now (its id), or null. */
  get current(): string | null {
    return this.shown;
  }

  /** Take the outline away (the camera stays). */
  clear(): void {
    if (this.shown === null) return;
    this.shown = null;
    this.hooks.clearHighlights();
  }
}
