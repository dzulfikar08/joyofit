import { FIT4_SCREEN, RESOLUTIONS } from "@joyofit/hwt";
import { i18n } from "@/i18n";
import { SCREEN_PRESETS, presetById, type ScreenSpec } from "@/model/screens";

/**
 * What a `.hwt` for a project's screen is written as: the Huawei screen code and version, and how far it can be trusted.
 * `tested`: a preset checked on a watch with JoyoFit. `untested`: a preset from Huawei's table nobody has checked from Studio.
 * `experimental`: a custom size that happens to match a Huawei screen code; the version is a guess.
 */
export type HwtStatus = "tested" | "untested" | "experimental";

export type HwtTarget =
  | {
      ok: true;
      code: string;
      version: string;
      status: HwtStatus;
      /** Huawei's size limits (`checkFit4Limits`) describe this screen. Only HWHD13 has them. */
      limitsKnown: boolean;
    }
  | { ok: false; reason: string };

/** Version a custom size gets when no preset names one for its screen code: the basic `2.1.z` face. */
const FALLBACK_VERSION = "2.1.1";

export function hwtTarget(screen: ScreenSpec): HwtTarget {
  const preset = presetById(screen.presetId);
  if (preset) {
    return { ok: true, code: preset.hwtScreen, version: preset.hwtVersion, status: preset.tested ? "tested" : "untested", limitsKnown: preset.hwtScreen === FIT4_SCREEN };
  }
  // `RESOLUTIONS` lists height first and holds a few codes with the same size; the Huawei (HWHD) code comes first.
  const match = Object.values(RESOLUTIONS).find((r) => r.width === screen.width && r.height === screen.height);
  if (!match) return { ok: false, reason: i18n.t("export:target.noScreenCode", { width: screen.width, height: screen.height }) };
  const version = SCREEN_PRESETS.find((p) => p.hwtScreen === match.code)?.hwtVersion ?? FALLBACK_VERSION;
  return { ok: true, code: match.code, version, status: "experimental", limitsKnown: match.code === FIT4_SCREEN };
}

/** JoyoFit's phone app uploads photo faces to the Watch Fit 4 / 4 Pro only. */
export const canSendPhotoFace = (screen: ScreenSpec): boolean => presetById(screen.presetId)?.photoFace === true;
