// Photo reconstruction is a PROTOTYPE behind the same switch as layout saving: without
// VITE_LAYOUT_BACKEND=supabase it makes no network calls at all, even with a Supabase URL and key set.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as clientModule from '../supabaseClient';
import {
  uploadReconstructionPhoto,
  requestPhotoAnalysis,
  stageProposedLayout,
  updateProposalStatus,
  isPhotoReconstructionOn,
  RECONSTRUCTION_OFF,
} from '../reconstructionService';
import ProposedLayoutBanner from '../../ui/ProposedLayoutBanner';
import { useWorkspaceStore } from '../../store/workspaceStore';

const OFF = { ok: false, off: true, error: RECONSTRUCTION_OFF };

describe('reconstructionService without VITE_LAYOUT_BACKEND=supabase', () => {
  let mockSupabase;
  let bucket;
  let fetchSpy;

  beforeEach(() => {
    // A Supabase URL + key are configured, but the flag is not set
    vi.stubEnv('VITE_LAYOUT_BACKEND', '');
    const table = new Proxy({}, { get: () => vi.fn(() => table) });
    bucket = {
      upload: vi.fn(),
      getPublicUrl: vi.fn(),
      createSignedUrl: vi.fn(),
    };
    mockSupabase = {
      from: vi.fn(() => table),
      storage: { from: vi.fn(() => bucket) },
      channel: vi.fn(),
    };
    vi.spyOn(clientModule, 'supabase', 'get').mockReturnValue(mockSupabase);
    vi.spyOn(clientModule, 'isSupabaseConfigured', 'get').mockReturnValue(true);
    fetchSpy = vi.fn(() => Promise.reject(new Error('no network in this test')));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useWorkspaceStore.getState().resetWorkspace();
  });

  it('is off', () => {
    expect(isPhotoReconstructionOn()).toBe(false);
  });

  it('every exported async function says "Photo reconstruction is off" and makes zero network calls', async () => {
    const file = new File(['image-bytes'], 'office.png', { type: 'image/png' });
    const ctx = { companyId: 'c1', layoutId: 'l1' };

    expect(await uploadReconstructionPhoto(file, ctx)).toEqual(OFF);
    expect(await requestPhotoAnalysis('c1/l1/123_office.png', ctx)).toEqual(OFF);
    expect(await stageProposedLayout({
      ...ctx,
      storagePath: 'c1/l1/123_office.png',
      proposedLayout: { schemaVersion: 2, rooms: [], objects: [] },
    })).toEqual(OFF);
    expect(await updateProposalStatus('prop_1', 'approved')).toEqual(OFF);
    expect(await updateProposalStatus('prop_1', 'rejected')).toEqual(OFF);

    expect(mockSupabase.storage.from).not.toHaveBeenCalled();
    expect(bucket.upload).not.toHaveBeenCalled();
    expect(bucket.getPublicUrl).not.toHaveBeenCalled();
    expect(bucket.createSignedUrl).not.toHaveBeenCalled();
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockSupabase.channel).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the proposed-layout banner renders nothing, even with a proposal or an error in the store', () => {
    const store = useWorkspaceStore.getState();
    store.setProposedLayout({ proposalId: 'prop_1', layout: { rooms: [], objects: [] } });
    expect(renderToStaticMarkup(createElement(ProposedLayoutBanner, {}))).toBe('');
    store.setReconstructing(true);
    expect(renderToStaticMarkup(createElement(ProposedLayoutBanner, {}))).toBe('');
    store.setReconstructing(false, 'Something failed');
    expect(renderToStaticMarkup(createElement(ProposedLayoutBanner, {}))).toBe('');
  });

  it('a URL and key alone, or the flag alone, keep it off', () => {
    vi.stubEnv('VITE_LAYOUT_BACKEND', 'supabase');
    vi.spyOn(clientModule, 'isSupabaseConfigured', 'get').mockReturnValue(false);
    expect(isPhotoReconstructionOn()).toBe(false);
    vi.spyOn(clientModule, 'isSupabaseConfigured', 'get').mockReturnValue(true);
    vi.spyOn(clientModule, 'supabase', 'get').mockReturnValue(null);
    expect(isPhotoReconstructionOn()).toBe(false);
  });
});
