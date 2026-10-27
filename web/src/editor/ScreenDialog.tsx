import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import {
  CUSTOM_MAX,
  CUSTOM_MIN,
  SCREEN_PRESETS,
  presetById,
  presetScreen,
  type ScreenPreset,
  type ScreenShape,
  type ScreenSpec,
} from "@/model/screens";
import { screenPathData } from "@/render/shapes";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { cn } from "@/ui/utils";
import { Field, SegmentedField, SliderField } from "./fields";

/** Name of a screen for the header and the pickers: the preset's model name, or `custom`. */
export const screenName = (screen: ScreenSpec, custom: string): string => presetById(screen.presetId)?.name ?? custom;

/** The screen's outline at true aspect, `scale` px per screen px. Takes the colour of the surrounding text. */
export function ScreenOutline({ screen, scale, className }: { screen: ScreenSpec; scale: number; className?: string }) {
  const stroke = 1.5 / scale;
  const pad = stroke;
  return (
    <svg
      aria-hidden
      className={cn("shrink-0", className)}
      width={(screen.width + pad * 2) * scale}
      height={(screen.height + pad * 2) * scale}
      viewBox={`${-pad} ${-pad} ${screen.width + pad * 2} ${screen.height + pad * 2}`}
    >
      <path d={screenPathData(screen)} fill="rgb(0 0 0 / 85%)" stroke="currentColor" strokeWidth={stroke} strokeLinejoin="round" />
    </svg>
  );
}

const GROUPS = [
  { id: "squircle", shape: "squircle" },
  { id: "round", shape: "circle" },
  { id: "band", shape: "rect" },
] as const;

const CARD =
  "pressable relative flex cursor-pointer flex-col gap-1 rounded-2xl bg-muted p-3 text-left transition-colors duration-150 hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)] has-checked:ring-2 has-checked:ring-primary has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface CustomDraft {
  /** Kept as typed so a half-typed number is not rewritten under the cursor. */
  width: string;
  height: string;
  shape: ScreenShape;
  radius: number;
}

const toDraft = (s: ScreenSpec): CustomDraft => ({ width: String(s.width), height: String(s.height), shape: s.shape, radius: s.cornerRadius });

function sizeOf(text: string, fallback: number): number {
  const n = Math.round(Number(text));
  return text.trim() !== "" && Number.isFinite(n) ? clamp(n, CUSTOM_MIN, CUSTOM_MAX) : fallback;
}

function customScreen(draft: CustomDraft, fallback: ScreenSpec): ScreenSpec {
  const width = sizeOf(draft.width, fallback.width);
  const height = sizeOf(draft.height, fallback.height);
  const cornerRadius = draft.shape === "circle" ? 0 : clamp(draft.radius, 0, Math.floor(Math.min(width, height) / 2));
  return { presetId: null, width, height, shape: draft.shape, cornerRadius };
}

function Marker({ tested }: { tested: boolean }) {
  const { t } = useTranslation("screen");
  return (
    <span
      className={cn(
        "mt-1 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold",
        tested ? "bg-primary/10 text-primary" : "bg-foreground/8 text-muted-foreground",
      )}
    >
      {tested && <Check className="size-3" aria-hidden />}
      {tested ? t("tested") : t("untested")}
    </span>
  );
}

function PresetCard({ preset, group, checked, onSelect }: { preset: ScreenPreset; group: string; checked: boolean; onSelect: () => void }) {
  const { t } = useTranslation("screen");
  return (
    <label className={CARD}>
      <input type="radio" name={group} className="sr-only" checked={checked} onChange={onSelect} data-testid={`screen-option-${preset.presetId}`} />
      <span className="grid h-24 place-items-center text-muted-foreground">
        <ScreenOutline screen={preset} scale={0.17} />
      </span>
      <span className="block text-sm font-bold">{preset.name}</span>
      <span className="block text-xs font-semibold text-foreground/80 tabular-nums">{t("size", { width: preset.width, height: preset.height })}</span>
      <span className="block text-xs text-muted-foreground">{preset.devices}</span>
      <Marker tested={preset.tested} />
    </label>
  );
}

/**
 * Picks the screen of a face: a preset or a custom size and shape. `askFit` adds the choice of what happens to the layers already
 * placed (scale the design to the new screen, or keep every position); a picker with nothing to move leaves it out.
 */
export function ScreenDialog({
  open,
  onClose,
  value,
  askFit,
  onPick,
  testId = "screen-dialog",
}: {
  open: boolean;
  onClose: () => void;
  value: ScreenSpec;
  askFit: boolean;
  onPick: (screen: ScreenSpec, fit: "scale" | "keep") => void;
  /** Two pickers can exist at once (the header's and the templates dialog's): each needs its own. */
  testId?: string;
}) {
  const { t } = useTranslation("screen");
  // Radios share a group by name across the whole document, so each instance names its own.
  const uid = useId();
  const group = `screen-${uid}`;
  const [choice, setChoice] = useState<string>(value.presetId ?? "custom");
  const [custom, setCustom] = useState<CustomDraft>(() => toDraft(value));
  const [fit, setFit] = useState<"scale" | "keep">("scale");

  // Every opening starts from the face's current screen.
  useEffect(() => {
    if (!open) return;
    setChoice(value.presetId ?? "custom");
    setCustom(toDraft(value));
    setFit("scale");
    // Only the opening resets the draft; the value is read as it is then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const preset = presetById(choice);
  const customSpec = useMemo(() => customScreen(custom, value), [custom, value]);
  const screen = preset ? presetScreen(preset) : customSpec;
  const maxRadius = Math.floor(Math.min(customSpec.width, customSpec.height) / 2);
  const editCustom = (patch: Partial<CustomDraft>) => {
    setChoice("custom");
    setCustom((c) => ({ ...c, ...patch }));
  };

  const notes = [...(preset ? (preset.tested ? [] : [t("notice.untested")]) : [t("notice.custom")]), ...(preset?.photoFace ? [] : [t("notice.noPhoto")])];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("title")}
      description={t("description")}
      className="max-w-3xl"
      testId={testId}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            data-testid="screen-apply"
            onClick={() => {
              onPick(screen, askFit ? fit : "keep");
              onClose();
            }}
          >
            {t("apply")}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label={t("title")} className="space-y-5 pt-1">
        {GROUPS.map((g) => (
          <section key={g.id} aria-labelledby={`${group}-${g.id}`}>
            <h3 id={`${group}-${g.id}`} className="mb-2 text-sm font-bold">
              {t(`groups.${g.id}`)}
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SCREEN_PRESETS.filter((p) => p.shape === g.shape).map((p) => (
                <PresetCard key={p.presetId} preset={p} group={group} checked={choice === p.presetId} onSelect={() => setChoice(p.presetId)} />
              ))}
            </div>
          </section>
        ))}

        <section aria-labelledby={`${group}-custom`}>
          <h3 id={`${group}-custom`} className="mb-2 text-sm font-bold">
            {t("groups.custom")}
          </h3>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]">
            <label className={CARD}>
              <input type="radio" name={group} className="sr-only" checked={choice === "custom"} onChange={() => setChoice("custom")} data-testid="screen-option-custom" />
              <span className="grid h-44 place-items-center text-muted-foreground">
                <ScreenOutline screen={customSpec} scale={0.28} />
              </span>
              <span className="block text-sm font-bold">{t("custom")}</span>
              <span className="block text-xs font-semibold text-foreground/80 tabular-nums">{t("size", { width: customSpec.width, height: customSpec.height })}</span>
            </label>
            <div className="space-y-3 rounded-2xl bg-muted/60 p-3">
              <div className="grid grid-cols-2 gap-3">
                {(["width", "height"] as const).map((dim) => (
                  <Field key={dim} label={t(dim)}>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={CUSTOM_MIN}
                      max={CUSTOM_MAX}
                      aria-label={t(dim)}
                      data-testid={`screen-${dim}`}
                      value={custom[dim]}
                      onChange={(e) => editCustom({ [dim]: e.currentTarget.value })}
                      onBlur={() => setCustom((c) => ({ ...c, [dim]: String(customSpec[dim]) }))}
                      className="h-10 rounded-lg"
                    />
                  </Field>
                ))}
              </div>
              <p className="px-0.5 text-xs text-muted-foreground">{t("range", { min: CUSTOM_MIN, max: CUSTOM_MAX })}</p>
              <SegmentedField
                label={t("shape.label")}
                value={custom.shape}
                options={[
                  { value: "squircle", label: t("shape.squircle") },
                  { value: "circle", label: t("shape.circle") },
                  { value: "rect", label: t("shape.rect") },
                ]}
                onChange={(shape) => editCustom({ shape })}
              />
              {custom.shape !== "circle" && (
                <SliderField
                  label={t("cornerRadius")}
                  value={Math.min(custom.radius, maxRadius)}
                  min={0}
                  max={Math.max(1, maxRadius)}
                  unit="px"
                  onChange={(radius) => editCustom({ radius })}
                />
              )}
            </div>
          </div>
        </section>
      </div>

      {notes.length > 0 && (
        <ul className="mt-5 list-disc space-y-1 rounded-2xl bg-warning-soft p-4 pl-8 text-[0.8125rem] leading-relaxed" data-testid="screen-notes">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {askFit && (
        <fieldset className="mt-5 space-y-2">
          <legend className="mb-1 text-sm font-bold">{t("fit.label")}</legend>
          {(["scale", "keep"] as const).map((mode) => (
            <label key={mode} className="flex cursor-pointer items-start gap-3 rounded-2xl bg-muted p-3 has-checked:ring-2 has-checked:ring-primary has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50">
              <input type="radio" name={`${group}-fit`} className="mt-1 accent-primary" checked={fit === mode} onChange={() => setFit(mode)} data-testid={`screen-fit-${mode}`} />
              <span>
                <span className="block text-sm font-bold">{t(`fit.${mode}`)}</span>
                <span className="block text-[0.8125rem] text-muted-foreground">{t(`fit.${mode}Hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </Dialog>
  );
}
