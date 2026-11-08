/**
 * TourSystem.ts
 *
 * The company tour (v0.14.4, private-docs/EXPERIENCE_PLAN.md 3.5, decisions in its section 6): `engine.tour`.
 * The stops are planTour's (play/navigation/tour.js, planned in idle time by NavigationSystem.tourPlan()); this
 * walks them, through NavigationSystem.routeTo (source 'tour'), so walking, collisions, re-routing and the
 * route line are exactly Take me there's.
 *
 *   engine.tour.start({ follow: 'auto' | 'self' })  → at the main entrance (from above too: walking starts there)
 *   engine.tour.pause() / resume() / next() / previous() / skip() / goTo(n) / setFollow(f) / restart() / stop()
 *   engine.on('tour', (e) => …)  → { type, state, follow, index, count, stop, visited, … } on every change
 *
 * States: idle → (start) → at a stop ('stop': the room outlined, the stop's pause counts down) → walking to the
 * next one ('walking') → … → the last stop ('done'); 'paused' from either (Pause, P, a movement key or the
 * joystick in "Walk me"). Two ways to follow, switchable at any time: 'auto' ("Walk me": the character walks
 * itself) and 'self' ("I'll walk": the line shows the way, arriving completes the stop). Skip the walk, Previous
 * and a stop picked from the list jump there with a fade (setFader: the viewer's; none: at once). Arriving turns
 * to the way the stop faces; with prefers-reduced-motion a fade instead. Visited stops are ticked per browser
 * (play/navigation/tourVisited.js). Keys while a tour runs: P pauses / resumes, Esc ends the tour.
 * Free walking, Find and Take me there are unchanged while no tour runs.
 */

import type { TourPlan, TourStop, TourMention, NavigationEvent, FaceOnArrival, WalkMode, RouteAnswer } from './NavigationSystem';
import { readVisited, markVisited, clearVisited, browserStorage } from '../../play/navigation/tourVisited';

export type TourState = 'idle' | 'walking' | 'stop' | 'paused' | 'done';
/** 'auto' = "Walk me" (the default), 'self' = "I'll walk". */
export type TourFollow = 'auto' | 'self';

/** What the tour is doing now (status, and every 'tour' event). */
export interface TourStatus {
  state: TourState;
  follow: TourFollow;
  /** The stop now: the one you are at, or the one you are walking to (0-based; -1: no tour). */
  index: number;
  /** How many stops ("Stop 4 of 20"). */
  count: number;
  stop: TourStop | null;
  /** Paused: from walking to the stop, or at it. */
  pausedFrom: 'walking' | 'stop' | null;
  /** Walking: metres left to the stop. */
  remaining: number | null;
  /** At a stop: seconds left before the tour goes on (null: not counting down). */
  dwell: number | null;
  /** The stops visited (their ids), in this browser. */
  visited: string[];
  plan: TourPlan | null;
  /** The last passing mention ("On your left: Restrooms") and when it came (performance.now()). */
  mention: TourMention | null;
  mentionAt: number;
  /** Why the walk to a stop didn't work (it was skipped with a fade), or null. */
  message: string | null;
}

export type TourEventType =
  | 'started' | 'walking' | 'arrived' | 'paused' | 'resumed' | 'follow' | 'mention' | 'progress' | 'done' | 'ended' | 'problem';

/** The 'tour' event: what changed, and the status after it. */
export interface TourEvent extends TourStatus {
  type: TourEventType;
}

/** start()'s answer: the tour (its stops and time), or why it can't start. */
export interface TourAnswer {
  count?: number;
  minutes?: number;
  length?: number;
  problem?: string;
  message?: string;
}

/** The viewer's fade: mid() runs while the view is covered. */
export type TourFader = (mid: () => void) => Promise<void> | void;

interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

export interface TourHooks {
  /** The plan (planned now if it isn't ready). */
  plan: () => TourPlan;
  /** Start walking (from above: at the entrance); false: walking can't start. */
  startWalking: () => boolean;
  isWalking: () => boolean;
  getWalker: () => { x: number; z: number; floor: number } | null;
  /** Put the character there (the nearest free spot), facing yaw. */
  setPose: (pose: { x: number; z: number; floor: number; yaw: number; pitch?: number }) => void;
  routeTo: (spot: { x: number; z: number; floor: number; name: string }, options: { walk: WalkMode; face?: FaceOnArrival }) => RouteAnswer;
  navigation: {
    stop: () => boolean;
    pause: () => boolean;
    resume: () => boolean;
    setWalk: (walk: WalkMode) => boolean;
    readonly walking: { source?: string; paused: boolean } | null;
  };
  highlight: (ids: string[]) => void;
  clearHighlights: () => void;
  /** The walkthrough's keys: P and Esc while a tour runs (null: none). */
  setKeys: (handler: ((code: string) => boolean) | null) => void;
  emit: (event: TourEvent) => void;
  /** Which layout this is (its visited ticks). */
  layoutKey: () => string;
  /** prefers-reduced-motion. */
  reducedMotion?: () => boolean;
  /** At a stop: the camera higher and further back, so the room shows (instant: with reduced motion). */
  stopView?: (on: boolean, instant: boolean) => void;
  /** Where the ticks are kept (default window.localStorage). */
  storage?: StorageLike | null;
}

/** The outline of a tour stop. */
export const TOUR_HIGHLIGHT = '#2fbf71';
/** Arriving: looking this far down (rad). */
export const STOP_PITCH = -0.12;
/** At a stop, walking this far away (m) is "you go on" ("I'll walk": the next line) or a pause ("Walk me"). */
export const MOVED_AWAY = 0.8;
/** A passing mention is said within this distance (m) of its point on the route. */
export const MENTION_NEAR = 2.5;

export class TourSystem {
  private hooks: TourHooks;
  private fader: TourFader | null = null;
  private plan: TourPlan | null = null;
  private state: TourState = 'idle';
  private follow: TourFollow = 'auto';
  private index = -1;
  private pausedFrom: 'walking' | 'stop' | null = null;
  private remaining: number | null = null;
  private dwell: number | null = null;
  private pauseScale = 1;
  private visited: string[] = [];
  private mention: TourMention | null = null;
  private mentionAt = 0;
  private said = new Set<TourMention>();
  private message: string | null = null;
  /** Where you stood when you arrived at the stop (moving away from it: see MOVED_AWAY). */
  private arrivedAt: { x: number; z: number; floor: number } | null = null;
  /** A jump or a walk started after this one makes it stale. */
  private token = 0;
  /** Our own navigation.stop(): its 'stopped' event isn't "someone else ended it". */
  private stopping = false;
  private reducedOverride: boolean | null = null;

  constructor(hooks: TourHooks) {
    this.hooks = hooks;
  }

  private get storage(): StorageLike | null {
    return this.hooks.storage === undefined ? browserStorage() : this.hooks.storage;
  }

  /** The viewer's fade (Skip the walk, Previous, a stop from the list, arriving with reduced motion). */
  setFader(fader: TourFader | null): void {
    this.fader = fader;
  }

  /** prefers-reduced-motion, or this (tests): true = fades instead of turning; null = the browser's setting. */
  setReducedMotion(on: boolean | null): void {
    this.reducedOverride = on;
  }

  private get reduced(): boolean {
    return this.reducedOverride ?? this.hooks.reducedMotion?.() ?? false;
  }

  /** The status now. */
  get status(): TourStatus {
    const stops = this.plan?.stops ?? [];
    return {
      state: this.state, follow: this.follow, index: this.index, count: stops.length,
      stop: this.index >= 0 ? stops[this.index] ?? null : null, pausedFrom: this.pausedFrom,
      remaining: this.remaining, dwell: this.dwell, visited: [...this.visited], plan: this.plan,
      mention: this.mention, mentionAt: this.mentionAt, message: this.message,
    };
  }

  /** A tour runs (any state but idle). */
  get running(): boolean {
    return this.state !== 'idle';
  }

  /** The stops visited on this layout in this browser (also when no tour runs: the Find menu, the list). */
  visitedNow(): string[] {
    return this.running ? [...this.visited] : readVisited(this.storage, this.hooks.layoutKey());
  }

  private emit(type: TourEventType): void {
    this.hooks.emit({ type, ...this.status });
  }

  /**
   * Start the tour at the main entrance (from above: walking starts there; walking: a fade to it).
   * follow 'auto' ("Walk me", default) or 'self' ("I'll walk"); `from`: start at that stop (0-based, with a
   * fade); `pauseScale`: the stops' pauses × this (tests, demos; default 1).
   */
  start({ follow = 'auto', from = 0, pauseScale = 1 }: { follow?: TourFollow; from?: number; pauseScale?: number } = {}): TourAnswer {
    if (this.running) this.end({ silent: true });
    const plan = this.hooks.plan();
    if (!plan.stops.length) return { problem: 'NO_TOUR', message: 'There is nothing to tour here' };
    const wasWalking = this.hooks.isWalking();
    if (!this.hooks.startWalking()) return { problem: 'NOT_WALKING', message: 'Walking is not possible here' };
    this.plan = plan;
    this.follow = follow === 'self' ? 'self' : 'auto';
    this.pauseScale = Number.isFinite(pauseScale) && pauseScale >= 0 ? pauseScale : 1;
    this.visited = readVisited(this.storage, this.hooks.layoutKey());
    this.said = new Set();
    this.mention = null;
    this.message = null;
    this.hooks.setKeys((code) => this.key(code));
    const at = Math.max(0, Math.min(plan.stops.length - 1, Math.floor(from) || 0));
    // started from above: walking began at the entrance, which is the first stop
    this.state = 'stop';
    this.index = at;
    this.emit('started');
    if (at === 0 && !wasWalking) this.arrive(0);
    else void this.jump(at);
    return { count: plan.stops.length, minutes: plan.minutes, length: plan.length };
  }

  /** Start again from the first stop, the ticks cleared. */
  restart(): TourAnswer {
    this.visited = clearVisited(this.storage, this.hooks.layoutKey());
    return this.start({ follow: this.follow, pauseScale: this.pauseScale });
  }

  /** End the tour (Exit, Esc): you stay where you are, walking freely. false: no tour. */
  stop(): boolean {
    if (!this.running) return false;
    this.end();
    return true;
  }

  /** The camera's stop view on / off (eased; at once with reduced motion). */
  private view(on: boolean): void {
    this.hooks.stopView?.(on, this.reduced);
  }

  private end({ silent = false } = {}): void {
    this.token++;
    this.view(false);
    if (this.hooks.navigation.walking?.source === 'tour') this.navStop();
    this.hooks.clearHighlights();
    this.hooks.setKeys(null);
    this.state = 'idle';
    this.index = -1;
    this.pausedFrom = null;
    this.remaining = null;
    this.dwell = null;
    this.mention = null;
    this.message = null;
    this.arrivedAt = null;
    if (!silent) this.emit('ended');
  }

  private navStop(): void {
    this.stopping = true;
    try { this.hooks.navigation.stop(); } finally { this.stopping = false; }
  }

  /** Pause: the walk stops where you are ("Walk me"), or the stop's countdown. false: nothing to pause. */
  pause(): boolean {
    if (this.state === 'walking') {
      if (this.follow === 'auto') this.hooks.navigation.pause();
      this.pausedFrom = 'walking';
    } else if (this.state === 'stop') {
      this.pausedFrom = 'stop';
    } else {
      return false;
    }
    this.state = 'paused';
    this.emit('paused');
    return true;
  }

  /** Go on after a pause (Resume, P, G). false: not paused. */
  resume(): boolean {
    if (this.state !== 'paused') return false;
    if (this.pausedFrom === 'walking') {
      if (this.hooks.navigation.walking?.source !== 'tour') {
        this.walkTo(this.index); // the walk was taken over (a click on the floor): a new one from here
        return true;
      }
      if (this.follow === 'auto') this.hooks.navigation.resume();
      this.state = 'walking';
    } else {
      this.state = 'stop';
      this.arrivedAt = this.hooks.getWalker(); // where you are now: the countdown goes on from here
    }
    this.pausedFrom = null;
    this.emit('resumed');
    return true;
  }

  /** On to the next stop (walking: the one you were going to is left out). false: none. */
  next(): boolean {
    if (!this.plan || this.state === 'idle' || this.state === 'done') return false;
    const i = this.index + 1;
    if (i >= this.plan.stops.length) return false;
    this.walkTo(i);
    return true;
  }

  /** Back to the stop before (with a fade). false: none. */
  previous(): boolean {
    if (!this.plan || this.state === 'idle' || this.index <= 0) return false;
    void this.jump(this.index - 1);
    return true;
  }

  /** Skip the walk: walking, a fade to the stop you are walking to; at a stop, to the next one. false: none. */
  skip(): boolean {
    if (!this.plan || this.state === 'idle' || this.state === 'done') return false;
    const walking = this.state === 'walking' || this.pausedFrom === 'walking';
    const i = walking ? this.index : this.index + 1;
    if (i >= this.plan.stops.length) return false;
    void this.jump(i);
    return true;
  }

  /** Go to a stop of the list (0-based, a fade). false: no such stop. */
  goTo(index: number): boolean {
    if (!this.plan || this.state === 'idle' || !(index >= 0 && index < this.plan.stops.length)) return false;
    void this.jump(Math.floor(index));
    return true;
  }

  /** "Walk me" ('auto') or "I'll walk" ('self'), at any time (walking: the walk goes on that way). */
  setFollow(follow: TourFollow): boolean {
    const f: TourFollow = follow === 'self' ? 'self' : 'auto';
    if (this.state === 'idle') return false;
    this.follow = f;
    const walking = this.state === 'walking' || this.pausedFrom === 'walking';
    if (walking) {
      if (this.hooks.navigation.walking?.source === 'tour') {
        this.hooks.navigation.setWalk(f === 'auto' ? 'auto' : 'guide');
        this.state = 'walking';
        this.pausedFrom = null;
      } else {
        this.walkTo(this.index);
        return true;
      }
    }
    this.emit('follow');
    return true;
  }

  /** The tour's keys (while it runs): P pauses / resumes, Esc ends it. true = taken. */
  key(code: string): boolean {
    if (!this.running) return false;
    if (code === 'KeyP') {
      if (this.state === 'paused') this.resume();
      else this.pause();
      return true;
    }
    if (code === 'Escape') {
      this.stop();
      return true;
    }
    return false;
  }

  /** Walk to a stop (the route from where you are). */
  private walkTo(i: number): void {
    const stop = this.plan!.stops[i];
    this.token++;
    this.index = i;
    this.state = 'walking';
    this.pausedFrom = null;
    this.dwell = null;
    this.message = null;
    this.remaining = stop.leg?.length ?? null;
    this.hooks.clearHighlights();
    this.view(false);
    const r = this.hooks.routeTo(
      { x: stop.spot.x, z: stop.spot.z, floor: stop.spot.floor, name: stop.name },
      { walk: this.follow === 'auto' ? 'auto' : 'guide', face: this.reduced ? undefined : { yaw: stop.yaw, pitch: STOP_PITCH } },
    );
    if (r.problem) {
      // planned as reachable, but not from here (walked off somewhere): there with a fade
      this.message = r.message ?? 'No walking route';
      this.emit('problem');
      void this.jump(i);
      return;
    }
    this.remaining = r.length ?? this.remaining;
    this.emit('walking');
  }

  /** There at once, behind a fade (Skip the walk, Previous, the list). */
  private async jump(i: number): Promise<void> {
    const token = ++this.token;
    if (this.hooks.navigation.walking) this.navStop();
    const stop = this.plan!.stops[i];
    let ran = false;
    const there = () => {
      if (ran || token !== this.token || !this.running) return;
      ran = true;
      this.hooks.setPose({ x: stop.spot.x, z: stop.spot.z, floor: stop.spot.floor, yaw: stop.yaw, pitch: STOP_PITCH });
      this.arrive(i);
    };
    await this.covered(there);
  }

  /** mid() behind the viewer's fade (none: at once); a fader that fails or never calls it: called after it. */
  private async covered(mid: () => void): Promise<void> {
    try {
      await (this.fader ? this.fader(mid) : mid());
    } catch (e) {
      console.warn('[tour] the fade failed', e);
    } finally {
      mid();
    }
  }

  /** Arrived at a stop: outlined, ticked, its pause counts down (the last one: done). */
  private arrive(i: number): void {
    const plan = this.plan!;
    const stop = plan.stops[i];
    this.index = i;
    this.pausedFrom = null;
    this.remaining = null;
    this.state = i === plan.stops.length - 1 ? 'done' : 'stop';
    this.dwell = this.state === 'done' ? null : stop.pause * this.pauseScale;
    this.arrivedAt = this.hooks.getWalker();
    this.visited = markVisited(this.storage, this.hooks.layoutKey(), stop.id, this.visited);
    this.hooks.clearHighlights();
    const ids = stop.rooms.map((r) => r.id);
    if (ids.length) this.hooks.highlight(ids);
    this.view(true);
    this.emit('arrived');
    if (this.state === 'done') this.emit('done');
  }

  /** Every frame (LayoutEngine): the stop's countdown, moving away from a stop, passing mentions. */
  tick(dt: number): void {
    if (!this.plan || (this.state !== 'stop' && this.state !== 'walking')) return;
    const me = this.hooks.getWalker();
    if (this.state === 'stop') {
      const from = this.arrivedAt;
      const moved = me && from && (me.floor !== from.floor || Math.hypot(me.x - from.x, me.z - from.z) > MOVED_AWAY);
      if (moved && this.hooks.navigation.walking?.source !== 'click') {
        // "I'll walk": you go on (the line to the next stop); "Walk me": a pause (Resume walks on from here)
        this.view(false);
        if (this.follow === 'self') this.next();
        else this.pause();
        return;
      }
      if (this.dwell !== null && !this.hooks.navigation.walking) {
        this.dwell = Math.max(0, this.dwell - dt);
        if (this.dwell <= 0) this.next();
      }
      return;
    }
    // walking: "On your left: Restrooms" as you pass the door
    const leg = this.plan.stops[this.index]?.leg;
    if (!me || !leg) return;
    for (const m of leg.mentions) {
      if (this.said.has(m) || m.at.floor !== me.floor || Math.hypot(m.at.x - me.x, m.at.z - me.z) > MENTION_NEAR) continue;
      this.said.add(m);
      this.mention = m;
      this.mentionAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      this.emit('mention');
      break;
    }
  }

  /** NavigationSystem's events (LayoutEngine passes each one): the tour's own walk, or another one taking over. */
  onNavigation(e: NavigationEvent): void {
    if (!this.running) return;
    if (e.source !== 'tour') {
      // a click on the floor (or a page's goTo) took over the walk to the stop: paused, Resume walks on
      if (e.state === 'started' && this.state === 'walking') {
        this.state = 'paused';
        this.pausedFrom = 'walking';
        this.emit('paused');
      }
      return;
    }
    if (e.state === 'progress') {
      this.remaining = e.remaining ?? this.remaining;
      if (e.paused && this.state === 'walking' && this.follow === 'auto') {
        // a movement key or the joystick paused "Walk me" (as G would go on: resume)
        this.state = 'paused';
        this.pausedFrom = 'walking';
        this.emit('paused');
      } else if (!e.paused && this.state === 'paused' && this.pausedFrom === 'walking') {
        this.state = 'walking'; // G walked on
        this.pausedFrom = null;
        this.emit('resumed');
      } else {
        this.emit('progress');
      }
    } else if (e.state === 'arrived') {
      if (this.state === 'walking' || (this.state === 'paused' && this.pausedFrom === 'walking')) {
        if (this.reduced) {
          // no turning with reduced motion: facing the stop behind a fade
          const stop = this.plan!.stops[this.index];
          const i = this.index;
          const token = ++this.token;
          let ran = false;
          const turn = () => {
            if (ran || token !== this.token || !this.running) return;
            ran = true;
            const me = this.hooks.getWalker();
            if (me) this.hooks.setPose({ x: me.x, z: me.z, floor: me.floor, yaw: stop.yaw, pitch: STOP_PITCH });
            this.arrive(i);
          };
          void this.covered(turn);
        } else {
          this.arrive(this.index);
        }
      }
    } else if (e.state === 'failed') {
      this.message = e.message ?? 'The walk stopped';
      this.emit('problem');
      void this.jump(this.index); // there with a fade
    } else if (e.state === 'stopped' && !this.stopping) {
      // ended by someone else (Esc outside our keys, another layout, leaving walking): the tour ends
      this.end();
    }
  }

  /** The layout changed, walking ended, or the engine goes: the tour ends. */
  dispose(): void {
    if (this.running) this.end();
  }
}
