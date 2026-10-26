/**
 * Wear Engine identity of the watch navigation link (docs/watch-nav.md, "Fingerprints"). Both values are PLACEHOLDERS until the Huawei
 * developer account exists (JRG-440): with them the watch app's Wear Engine drops our messages, so the feature stays a lab switch.
 *
 * - `phoneFingerprint`: SHA-256 of the certificate that signs the JoyoFit store build, as AppGallery Connect lists it for the phone app
 *   (64 hex characters, upper case, no colons). The watch app carries the same string as its peer fingerprint.
 * - `watchFingerprint`: the watch app's fingerprint from its AppGallery Connect project, `com.joyodigitama.navi_<base64 public key of the
 *   watch app's signing certificate>` (at most 127 characters).
 *
 * The native side treats any value starting with `PLACEHOLDER` as unset and says so in its log and status.
 */
import type { WatchNavConfig } from '@/wear';

export const WATCH_APP_BUNDLE = 'com.joyodigitama.navi';

export const WATCH_NAV_CONFIG: WatchNavConfig = {
  phoneFingerprint: 'PLACEHOLDER-JRG440-PHONE-SHA256',
  watchFingerprint: 'PLACEHOLDER-JRG440-WATCH-FINGERPRINT',
};
