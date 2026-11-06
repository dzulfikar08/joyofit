/**
 * Wear Engine identity of the watch navigation link (docs/watch-nav.md, "Fingerprints"), registered with Huawei on 2026-11-06 (JRG-440).
 *
 * - `phoneFingerprint`: SHA-256 of the Play app-signing certificate (the key that signs the JoyoFit store build), as entered for the
 *   HUAWEI ID service of the JoyoFit product (64 hex characters, upper case, no colons). The watch app carries the same string as its
 *   peer fingerprint.
 * - `watchFingerprint`: `com.joyodigitama.navi_<base64 public key>` of the JoyoNavi debug certificate (AGC "JoyoNavi debug", valid to
 *   2027-11-06). It changes when JoyoNavi is signed with a release certificate.
 *
 * The native side treats any value starting with `PLACEHOLDER` as unset and says so in its log and status.
 */
import type { WatchNavConfig } from '@/wear';

export const WATCH_APP_BUNDLE = 'com.joyodigitama.navi';

export const WATCH_NAV_CONFIG: WatchNavConfig = {
  phoneFingerprint: '5702ADC96D179243217B41840B026B809AB85F9A590E32BEE22752805F43C04A',
  watchFingerprint:
    'com.joyodigitama.navi_BBMPwlw6Tu82y6yXjMiJc0aif5pBCEi41o/yj/+PAgMlhdZx3UN0jvGxhuZn2XksCTbSAUfEiSvu5sjOru7uwPw=',
};
