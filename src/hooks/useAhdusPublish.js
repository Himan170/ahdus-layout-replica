/**
 * useAhdusPublish.js
 *
 * Workplace Studio inside AHDUS (VITE_LAYOUT_BACKEND=ahdus; with `enabled` false it does
 * nothing): publishing and leaving, with the rules in ui/publishFlow.js.
 * - The publish state (Publish / Publish changes / Published ✓): the store's draftRevision
 *   and publishedRevision, asked from AHDUS when Studio opens and after each publish.
 * - Publish → the Publish dialog (ui/PublishDialogs.jsx) → a toast: green with a link to the
 *   3D Company page, or red with the reason.
 * - Leaving (Back to AHDUS) with unpublished changes → the leave dialog (Stay / Publish now /
 *   Leave); closing or reloading the tab → the browser's own "Leave site?" prompt.
 * - A save that fails (409, 401, 403, no connection) → a red toast too (the status bar still
 *   says it); 401's toast links to the AHDUS login.
 * - Renaming the site: a red toast when AHDUS refuses the name.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useWorkspaceStore } from '../store/workspaceStore';
import { publishLayout, refreshPublishInfo, renameLayout } from '../services/apiService';
import { AHDUS_LOGIN_EXPIRED, companyPageUrl, loginUrl } from '../services/ahdusBackend';
import { publishState as publishStateOf, sentence, shouldWarnOnLeave } from '../ui/publishFlow';

let toastId = 0;

export function useAhdusPublish({ enabled, onLeave }) {
  const [dialog, setDialog] = useState(null); // null | 'publish' | 'leave'
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState(null);
  const draftRevision = useWorkspaceStore((s) => s.draftRevision);
  const publishedRevision = useWorkspaceStore((s) => s.publishedRevision);
  const isDirty = useWorkspaceStore((s) => s.isDirty);
  const state = publishStateOf({ draftRevision, publishedRevision, isDirty });
  const busyRef = useRef(false);

  const showToast = useCallback((tone, text, link = null) => {
    toastId += 1;
    setToast({ id: toastId, tone, text, link });
  }, []);
  const closeToast = useCallback((id) => setToast((t) => (t && (id == null || t.id === id) ? null : t)), []);
  const errorToast = useCallback((text) => {
    const expired = String(text ?? '').includes(AHDUS_LOGIN_EXPIRED);
    showToast('bad', text, expired ? { href: loginUrl(), label: 'Log in' } : null);
  }, [showToast]);

  // What employees see: asked when Studio opens
  useEffect(() => {
    if (!enabled) return;
    refreshPublishInfo().then((res) => {
      if (!res.ok) console.warn('[AHDUS] could not read the published version:', res.error);
    });
  }, [enabled]);

  // A failed save says so in a toast too (once per new reason; the next change retries)
  useEffect(() => {
    if (!enabled) return undefined;
    return useWorkspaceStore.subscribe((s) => s.saveError, (error) => {
      if (error) errorToast(`Not saved: ${error}`);
    });
  }, [enabled, errorToast]);

  // Closing or reloading the tab with unpublished changes, or a save still on its way
  useEffect(() => {
    if (!enabled) return undefined;
    const onBeforeUnload = (e) => {
      const s = useWorkspaceStore.getState();
      if (!s.layoutId) return; // left through Studio (the store is reset first)
      if (!shouldWarnOnLeave({ ahdus: true, draftRevision: s.draftRevision, publishedRevision: s.publishedRevision, isDirty: s.isDirty })) return;
      e.preventDefault();
      e.returnValue = ''; // older browsers need it set to show their prompt
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [enabled]);

  /** Save, publish, say how it went. @returns {Promise<boolean>} published */
  const publish = useCallback(async () => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setPublishing(true);
    try {
      const res = await publishLayout();
      if (!res.ok) {
        errorToast(`Not published: ${sentence(res.error)}`);
        return false;
      }
      const site = useWorkspaceStore.getState().layoutId;
      showToast('ok', 'Published. Employees now see this version.',
        { href: companyPageUrl(site), label: 'View on the 3D Company page' });
      refreshPublishInfo();
      return true;
    } finally {
      busyRef.current = false;
      setPublishing(false);
    }
  }, [errorToast, showToast]);

  const openPublish = useCallback(() => setDialog('publish'), []);
  const cancelDialog = useCallback(() => { if (!busyRef.current) setDialog(null); }, []);
  const confirmPublish = useCallback(async () => {
    await publish();
    setDialog(null);
  }, [publish]);

  /** Back to AHDUS: ask first when employees would still see an older version. */
  const requestLeave = useCallback(() => {
    const s = useWorkspaceStore.getState();
    if (shouldWarnOnLeave({ ahdus: enabled, draftRevision: s.draftRevision, publishedRevision: s.publishedRevision, isDirty: s.isDirty })) {
      setDialog('leave');
    } else {
      onLeave();
    }
  }, [enabled, onLeave]);
  const publishAndLeave = useCallback(async () => {
    if (await publish()) onLeave();
    else setDialog(null);
  }, [publish, onLeave]);
  const leaveAnyway = useCallback(() => { setDialog(null); onLeave(); }, [onLeave]);

  const renameSite = useCallback(async (name) => {
    const res = await renameLayout(name);
    if (res && !res.ok) errorToast(`Not renamed: ${sentence(res.error)}`);
  }, [errorToast]);

  return {
    state, publishing, dialog, toast, closeToast,
    openPublish, cancelDialog, confirmPublish, requestLeave, publishAndLeave, leaveAnyway, renameSite,
  };
}
