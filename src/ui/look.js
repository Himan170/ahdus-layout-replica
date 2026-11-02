/**
 * ui/look.js
 *
 * Which look Workplace Studio has:
 *   'ahdus'    inside AHDUS (VITE_LAYOUT_BACKEND=ahdus): light page, AHDUS green, the tool rail,
 *              the library panel, camera controls on the canvas (ui/ahdus.css, theme.css tokens)
 *   'classic'  everywhere else: the dark look of v0.9 (local mode keeps it, so we can switch back)
 * In dev, ?look=ahdus or ?look=classic in the address overrides it (tests, screenshots).
 * The look never changes while the page is open.
 */

import { useEffect, useState } from 'react';
import { isAhdusBackendOn } from '../services/backendFlags';

const LOOKS = ['ahdus', 'classic'];

/** @returns {'ahdus'|'classic'} */
export function studioLook(search = typeof window !== 'undefined' ? window.location.search : '') {
  if (import.meta.env?.DEV) {
    const asked = new URLSearchParams(search).get('look');
    if (LOOKS.includes(asked)) return asked;
  }
  return isAhdusBackendOn() ? 'ahdus' : 'classic';
}

export const isAhdusLook = () => studioLook() === 'ahdus';

/** data-look on <html>: theme.css swaps the colour tokens with it (the splash and dialogs use them too). */
export function applyStudioLook(doc = typeof document !== 'undefined' ? document : null) {
  if (doc?.documentElement) doc.documentElement.dataset.look = studioLook();
}

/** The AHDUS look's phone layout (ui/ahdus.css uses the same width). */
export const PHONE_QUERY = '(max-width: 600px)';

/** True while the window is phone-wide; follows a resize or a turned phone. */
export function usePhone() {
  const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(PHONE_QUERY) : null;
  const [phone, setPhone] = useState(() => !!media?.matches);
  useEffect(() => {
    if (!media) return undefined;
    const sync = () => setPhone(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, [media?.media]); // eslint-disable-line react-hooks/exhaustive-deps
  return phone;
}
