import type { Overlay } from './overlay';

/** Android (and unit tests) show the base strings. Metro picks `platformOverlay.ios.ts` on iOS. */
export const platformOverlay: Overlay | null = null;
