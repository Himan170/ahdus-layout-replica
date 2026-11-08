// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chooseStart, softwareRenderer, welcomeTitle, welcomeActions, readStartMode, rememberStartMode, START_MODE_KEY,
} from '../startMode';

describe('chooseStart (v0.14.6)', () => {
  it('walks by default, with the welcome card', () => {
    expect(chooseStart({ startMode: 'walkthrough' })).toEqual({ mode: 'walkthrough', welcome: true, reason: 'start' });
    expect(chooseStart({ startMode: 'view' })).toEqual({ mode: 'view', welcome: false, reason: 'start' });
  });
  it('the last choice wins over startMode (a walk again shows the card)', () => {
    expect(chooseStart({ startMode: 'walkthrough', remembered: 'view' })).toEqual({ mode: 'view', welcome: false, reason: 'remembered' });
    expect(chooseStart({ startMode: 'view', remembered: 'walkthrough' })).toEqual({ mode: 'walkthrough', welcome: true, reason: 'remembered' });
  });
  it('a weak device starts from above, whatever was chosen', () => {
    expect(chooseStart({ startMode: 'walkthrough', remembered: 'walkthrough', weak: true })).toEqual({ mode: 'view', welcome: false, reason: 'weak' });
    expect(chooseStart({ startMode: 'walkthrough', weak: true, openAt: true }).mode).toBe('view');
  });
  it('a deep link: no welcome card, the mode as it would be', () => {
    expect(chooseStart({ startMode: 'walkthrough', openAt: true })).toEqual({ mode: 'walkthrough', welcome: false, reason: 'link' });
    expect(chooseStart({ startMode: 'walkthrough', remembered: 'view', openAt: true })).toEqual({ mode: 'view', welcome: false, reason: 'link' });
  });
});

describe('the welcome card\'s words', () => {
  it('"Welcome to …", else "Welcome"', () => {
    expect(welcomeTitle('Meridian HQ')).toBe('Welcome to Meridian HQ');
    expect(welcomeTitle('  ')).toBe('Welcome');
    expect(welcomeTitle(null)).toBe('Welcome');
  });
  it('Start the tour and Find someone only where the viewer has them', () => {
    expect(welcomeActions()).toEqual(['tour', 'explore', 'find']);
    expect(welcomeActions({ tour: false })).toEqual(['explore', 'find']);
    expect(welcomeActions({ tour: false, search: false })).toEqual(['explore']);
  });
});

describe('softwareRenderer', () => {
  it('finds WebGL drawn by the CPU', () => {
    for (const r of ['Google SwiftShader', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))', 'llvmpipe (LLVM 15.0.7, 256 bits)',
      'Microsoft Basic Render Driver', 'Mesa OffScreen', 'GDI Generic']) expect(softwareRenderer(r)).toBe(true);
    for (const r of ['ANGLE (Intel, Intel(R) UHD Graphics Direct3D11)', 'Apple M2', 'Adreno (TM) 650', 'Mali-G78', '', undefined]) {
      expect(softwareRenderer(r)).toBe(false);
    }
  });
});

describe('the last choice, per browser', () => {
  afterEach(() => { vi.restoreAllMocks(); window.localStorage.removeItem(START_MODE_KEY); });
  it('remembered, read back; anything else = none', () => {
    expect(readStartMode()).toBeNull();
    rememberStartMode('view');
    expect(readStartMode()).toBe('view');
    window.localStorage.setItem(START_MODE_KEY, 'edit');
    expect(readStartMode()).toBeNull();
  });
  it('storage blocked: no error, nothing remembered', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => rememberStartMode('view')).not.toThrow();
    expect(readStartMode()).toBeNull();
  });
});
