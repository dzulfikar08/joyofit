import type { Overlay } from '../overlay';

import idCoach from './ios/id/coach.json';
import idFamily from './ios/id/family.json';
import idHealth from './ios/id/health.json';
import idNoWatch from './ios/id/nowatch.json';
import idOnboarding from './ios/id/onboarding.json';
import idRoutes from './ios/id/routes.json';
import idScale from './ios/id/scale.json';
import idSettings from './ios/id/settings.json';
import idToday from './ios/id/today.json';
import idWatch from './ios/id/watch.json';
import idWorkouts from './ios/id/workouts.json';
import enCoach from './ios/en/coach.json';
import enFamily from './ios/en/family.json';
import enHealth from './ios/en/health.json';
import enNoWatch from './ios/en/nowatch.json';
import enOnboarding from './ios/en/onboarding.json';
import enRoutes from './ios/en/routes.json';
import enScale from './ios/en/scale.json';
import enSettings from './ios/en/settings.json';
import enToday from './ios/en/today.json';
import enWatch from './ios/en/watch.json';
import enWorkouts from './ios/en/workouts.json';

/**
 * iOS shows no Huawei or Honor branding (App Store guideline 4.1(b): no authorization from the brand owners); Android keeps the
 * base copy. `overlay.test.ts` fails on a brand word left in any string iOS can show.
 */
export const iosOverlay: Overlay = {
  id: { coach: idCoach, family: idFamily, health: idHealth, nowatch: idNoWatch, onboarding: idOnboarding, routes: idRoutes, scale: idScale, settings: idSettings, today: idToday, watch: idWatch, workouts: idWorkouts },
  en: { coach: enCoach, family: enFamily, health: enHealth, nowatch: enNoWatch, onboarding: enOnboarding, routes: enRoutes, scale: enScale, settings: enSettings, today: enToday, watch: enWatch, workouts: enWorkouts },
};
