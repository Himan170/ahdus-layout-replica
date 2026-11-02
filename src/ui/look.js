/**
 * ui/look.js
 *
 * Workplace Studio has one look, the AHDUS look (since v0.10.1, in local mode too): light page,
 * AHDUS green, the tool rail, the library panel, camera controls on the canvas (ui/ahdus.css,
 * theme.css). Only its phone layout depends on the window: usePhone().
 */

import { useEffect, useState } from 'react';

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
