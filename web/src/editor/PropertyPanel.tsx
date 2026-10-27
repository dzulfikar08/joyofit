import { useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp, Copy, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { addAssetFromFile, assetsVersion, getAsset, subscribeAssets } from "@/model/assets";
import { ELEMENT_LABELS } from "@/model/defaults";
import { FIELDS, fieldDef, numberFields, ratioFields, type FieldDef } from "@/model/fields";
import {
  type BackgroundElement,
  type DateElement,
  type DatePart,
  type Element,
  type HandElement,
  type IconSetElement,
  type ImageElement,
  type RingElement,
  type TimeElement,
  type WidgetElement,
} from "@/model/types";
import { elementSupport, levelOfId } from "@/export/support";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { cn } from "@/ui/utils";
import {
  ColorField,
  Field,
  FontField,
  NumberInput,
  OutlineField,
  Row,
  SegmentedField,
  SliderField,
  ToggleRow,
  UploadButton,
} from "./fields";
import { useEditor } from "./store";

type Patch<T extends Element> = (patch: Partial<T>) => void;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="px-0.5 text-sm font-bold tracking-tight">{title}</h3>
      {children}
    </section>
  );
}

function PositionFields({ el, set, pivot }: { el: Element; set: Patch<Element>; pivot?: boolean }) {
  const { t } = useTranslation("props");
  return (
    <Section title={pivot ? t("section.pivotPosition") : t("section.position")}>
      <div className="grid grid-cols-2 gap-3">
        <Row label="X">
          <NumberInput label="X" value={el.x} min={-400} max={800} onChange={(x) => set({ x: Math.round(x) })} />
        </Row>
        <Row label="Y">
          <NumberInput label="Y" value={el.y} min={-400} max={900} onChange={(y) => set({ y: Math.round(y) })} />
        </Row>
      </div>
    </Section>
  );
}

function BackgroundFields({ el, set }: { el: BackgroundElement; set: Patch<BackgroundElement> }) {
  const { t } = useTranslation("props");
  const fill = el.fill;
  const upload = async (file: File) => {
    try {
      const assetId = await addAssetFromFile(file, "photo");
      set({ fill: { kind: "image", assetId, zoom: 1, offsetX: 0, offsetY: 0, dim: fill.kind === "image" ? fill.dim : 0.25 } });
    } catch {
      toast.error(t("common.imageReadError"));
    }
  };
  return (
    <Section title={t("section.background")}>
      <SegmentedField
        label={t("background.fill")}
        value={fill.kind}
        options={[
          { value: "solid", label: t("background.solid") },
          { value: "gradient", label: t("background.gradient") },
          { value: "image", label: t("background.photo") },
        ]}
        onChange={(kind) => {
          if (kind === "solid") set({ fill: { kind, color: fill.kind === "solid" ? fill.color : "#000000" } });
          else if (kind === "gradient")
            set({ fill: { kind, from: fill.kind === "gradient" ? fill.from : "#0F2F3A", to: fill.kind === "gradient" ? fill.to : "#000000", angle: 180 } });
          else set({ fill: { kind, assetId: fill.kind === "image" ? fill.assetId : null, zoom: 1, offsetX: 0, offsetY: 0, dim: 0.25 } });
        }}
      />
      {fill.kind === "solid" && <ColorField label={t("common.color")} value={fill.color} onChange={(color) => set({ fill: { ...fill, color } })} />}
      {fill.kind === "gradient" && (
        <>
          <ColorField label={t("background.from")} value={fill.from} onChange={(from) => set({ fill: { ...fill, from } })} />
          <ColorField label={t("background.to")} value={fill.to} onChange={(to) => set({ fill: { ...fill, to } })} />
          <SliderField label={t("background.angle")} value={fill.angle} min={0} max={360} unit="°" onChange={(angle) => set({ fill: { ...fill, angle } })} />
        </>
      )}
      {fill.kind === "image" && (
        <>
          <UploadButton label={fill.assetId ? t("background.replacePhoto") : t("background.uploadPhoto")} onFile={upload} />
          {fill.assetId && (
            <>
              <p className="px-0.5 text-xs text-muted-foreground">{t("background.dragHint")}</p>
              <SliderField label={t("background.zoom")} value={fill.zoom} min={1} max={3} step={0.01} unit="×" onChange={(zoom) => set({ fill: { ...fill, zoom } })} />
              <SliderField label={t("background.horizontal")} value={fill.offsetX} min={-1} max={1} step={0.01} onChange={(offsetX) => set({ fill: { ...fill, offsetX } })} />
              <SliderField label={t("background.vertical")} value={fill.offsetY} min={-1} max={1} step={0.01} onChange={(offsetY) => set({ fill: { ...fill, offsetY } })} />
              <SliderField
                label={t("background.dim")}
                value={fill.dim}
                min={0}
                max={0.8}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(dim) => set({ fill: { ...fill, dim } })}
              />
            </>
          )}
        </>
      )}
    </Section>
  );
}

function TimeFields({ el, set }: { el: TimeElement; set: Patch<TimeElement> }) {
  const { t } = useTranslation("props");
  return (
    <>
      <Section title={t("section.digits")}>
        <FontField value={el.font} onChange={(font) => set({ font })} />
        <SliderField label={t("common.digitHeight")} value={el.size} min={24} max={240} unit="px" onChange={(size) => set({ size })} />
        <ColorField label={t("common.color")} value={el.color} onChange={(color) => set({ color })} />
        <OutlineField value={el.outline} onChange={(outline) => set({ outline })} fallback="#000000" />
        <SliderField label={t("common.spacing")} value={el.tracking} min={-8} max={30} unit="px" onChange={(tracking) => set({ tracking })} />
      </Section>
      <Section title={t("section.layout")}>
        <SegmentedField
          label={t("time.arrangement")}
          value={el.layout}
          options={[
            { value: "row", label: t("time.oneRow") },
            { value: "stack", label: t("time.stacked") },
          ]}
          onChange={(layout) => set({ layout })}
        />
        {el.layout === "row" && <ToggleRow label={t("time.colon")} checked={el.showColon} onChange={(showColon) => set({ showColon })} />}
        <ToggleRow label={t("time.seconds")} checked={el.showSeconds} onChange={(showSeconds) => set({ showSeconds })} />
        <ToggleRow label={t("time.ampm")} checked={el.ampm} onChange={(ampm) => set({ ampm })} />
        {(el.showSeconds || el.ampm) && (
          <SliderField
            label={t("time.secondsSize")}
            value={el.secondsScale}
            min={0.2}
            max={0.8}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(secondsScale) => set({ secondsScale })}
          />
        )}
      </Section>
    </>
  );
}

const DATE_PARTS: DatePart[] = ["weekday", "day", "month"];

function DateFields({ el, set }: { el: DateElement; set: Patch<DateElement> }) {
  const { t } = useTranslation("props");
  return (
    <>
      <Section title={t("section.shows")}>
        <div className="flex gap-1.5">
          {DATE_PARTS.map((part) => {
            const on = el.parts.includes(part);
            return (
              <button
                key={part}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? el.parts.filter((p) => p !== part) : [...el.parts, part];
                  if (next.length > 0) set({ parts: next });
                }}
                className={cn(
                  "pressable h-8 min-w-0 flex-1 truncate rounded-full px-3 text-[0.8125rem] font-semibold transition-colors duration-150",
                  on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`date.${part}`)}
              </button>
            );
          })}
        </div>
        <ToggleRow label={t("date.upper")} checked={el.upper} onChange={(upper) => set({ upper })} />
      </Section>
      <Section title={t("section.text")}>
        <FontField value={el.font} onChange={(font) => set({ font })} />
        <SliderField label={t("common.digitHeight")} value={el.size} min={12} max={120} unit="px" onChange={(size) => set({ size })} />
        <ColorField label={t("common.color")} value={el.color} onChange={(color) => set({ color })} />
        <OutlineField value={el.outline} onChange={(outline) => set({ outline })} fallback="#000000" />
        <SliderField label={t("common.spacing")} value={el.tracking} min={-4} max={30} unit="px" onChange={(tracking) => set({ tracking })} />
      </Section>
    </>
  );
}

function HandFields({ el, set }: { el: HandElement; set: Patch<HandElement> }) {
  const { t, i18n } = useTranslation("props");
  const upload = async (file: File) => {
    try {
      const assetId = await addAssetFromFile(file, "sprite");
      const img = getAsset(assetId);
      set({
        shape: "custom",
        assetId,
        pivotX: Math.round((img?.width ?? 20) / 2),
        pivotY: Math.round((img?.height ?? 200) * 0.85),
        scale: 1,
      });
    } catch {
      toast.error(t("common.imageReadError"));
    }
  };
  return (
    <>
      <Section title={t("section.hand")}>
        <SegmentedField
          label={t("common.shows")}
          value={el.hand}
          options={[
            { value: "hour", label: t("hand.hour") },
            { value: "minute", label: t("hand.minute") },
            { value: "second", label: t("hand.second") },
          ]}
          onChange={(hand) => set({ hand, name: i18n.t(`editor:defaults.${hand}Hand`) })}
        />
        <SegmentedField
          label={t("hand.shape")}
          value={el.shape}
          options={[
            { value: "classic", label: t("hand.classic") },
            { value: "baton", label: t("hand.baton") },
            { value: "sword", label: t("hand.sword") },
            { value: "needle", label: t("hand.needle") },
            { value: "custom", label: t("hand.png") },
          ]}
          onChange={(shape) => set({ shape })}
        />
        {el.shape !== "custom" ? (
          <>
            <ColorField label={t("common.color")} value={el.color} onChange={(color) => set({ color })} />
            <SliderField label={t("hand.length")} value={el.length} min={20} max={240} unit="px" onChange={(length) => set({ length })} />
            <SliderField label={t("hand.width")} value={el.width} min={2} max={40} unit="px" onChange={(width) => set({ width })} />
            <SliderField label={t("hand.counterweight")} value={el.tail} min={0} max={80} unit="px" onChange={(tail) => set({ tail })} />
          </>
        ) : (
          <>
            <UploadButton label={el.assetId ? t("hand.replacePng") : t("hand.uploadPng")} accept="image/png" onFile={upload} />
            <p className="px-0.5 text-xs text-muted-foreground">{t("hand.pngHint")}</p>
            {el.assetId && (
              <>
                <SliderField label={t("hand.scale")} value={el.scale} min={0.2} max={2} step={0.01} unit="×" onChange={(scale) => set({ scale })} />
                <div className="grid grid-cols-2 gap-3">
                  <Row label={t("hand.pivotX")}>
                    <NumberInput label={t("hand.pivotX")} value={el.pivotX} min={0} onChange={(pivotX) => set({ pivotX: Math.round(pivotX) })} />
                  </Row>
                  <Row label={t("hand.pivotY")}>
                    <NumberInput label={t("hand.pivotY")} value={el.pivotY} min={0} onChange={(pivotY) => set({ pivotY: Math.round(pivotY) })} />
                  </Row>
                </div>
              </>
            )}
          </>
        )}
      </Section>
    </>
  );
}

function ImageFields({ el, set }: { el: ImageElement; set: Patch<ImageElement> }) {
  const { t } = useTranslation("props");
  const [lock, setLock] = useState(true);
  const img = getAsset(el.assetId);
  const ratio = img ? img.width / img.height : el.w / Math.max(1, el.h);
  const upload = async (file: File) => {
    try {
      const assetId = await addAssetFromFile(file, "sprite");
      const loaded = getAsset(assetId);
      if (loaded) {
        const k = Math.min(1, 280 / Math.max(loaded.width, loaded.height));
        set({ assetId, w: Math.round(loaded.width * k), h: Math.round(loaded.height * k) });
      } else set({ assetId });
    } catch {
      toast.error(t("common.imageReadError"));
    }
  };
  return (
    <Section title={t("section.image")}>
      <UploadButton label={el.assetId ? t("image.replace") : t("image.upload")} onFile={upload} />
      <ToggleRow label={t("image.keepProportions")} checked={lock} onChange={setLock} />
      <div className="grid grid-cols-2 gap-3">
        <Row label={t("common.width")}>
          <NumberInput
            label={t("common.width")}
            value={el.w}
            min={4}
            max={1600}
            onChange={(w) => set(lock ? { w: Math.round(w), h: Math.max(1, Math.round(w / ratio)) } : { w: Math.round(w) })}
          />
        </Row>
        <Row label={t("common.height")}>
          <NumberInput
            label={t("common.height")}
            value={el.h}
            min={4}
            max={1600}
            onChange={(h) => set(lock ? { h: Math.round(h), w: Math.max(1, Math.round(h * ratio)) } : { h: Math.round(h) })}
          />
        </Row>
      </div>
    </Section>
  );
}

/** Picks a registry field by name. A value the picker does not list (an old project's calories) stays selectable. */
function FieldPicker({ label, value, options, onChange }: { label: string; value: number; options: FieldDef[]; onChange: (def: FieldDef) => void }) {
  const { t } = useTranslation("props");
  const current = fieldDef(value);
  const list = current && !options.includes(current) ? [current, ...options] : options;
  return (
    <Field label={label}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => {
          const def = fieldDef(Number(e.currentTarget.value));
          if (def) onChange(def);
        }}
        className="h-9 w-full rounded-xl border border-transparent bg-muted px-3 text-[0.8125rem] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
      >
        {list.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
            {levelOfId(f.id) === "verified" ? "" : levelOfId(f.id) === "experimental" ? t("common.unconfirmedSuffix") : t("common.previewOnlySuffix")}
          </option>
        ))}
      </select>
    </Field>
  );
}

function WidgetFields({ el, set }: { el: WidgetElement; set: Patch<WidgetElement> }) {
  const { t } = useTranslation("props");
  return (
    <>
      <Section title={t("section.data")}>
        <FieldPicker
          label={t("common.shows")}
          value={el.valueType}
          options={numberFields()}
          onChange={(def) => set({ valueType: def.id, name: def.label, iconColor: def.color })}
        />
      </Section>
      <Section title={t("section.number")}>
        <FontField value={el.font} onChange={(font) => set({ font })} />
        <SliderField label={t("common.digitHeight")} value={el.size} min={14} max={120} unit="px" onChange={(size) => set({ size })} />
        <ColorField label={t("common.color")} value={el.color} onChange={(color) => set({ color })} />
        <OutlineField value={el.outline} onChange={(outline) => set({ outline })} fallback="#000000" />
        <SliderField label={t("common.spacing")} value={el.tracking} min={-4} max={20} unit="px" onChange={(tracking) => set({ tracking })} />
      </Section>
      <Section title={t("section.icon")}>
        <ToggleRow label={t("widget.showIcon")} checked={el.showIcon} onChange={(showIcon) => set({ showIcon })} />
        {el.showIcon && (
          <>
            <ColorField label={t("widget.iconColor")} value={el.iconColor} onChange={(iconColor) => set({ iconColor })} />
            <SegmentedField
              label={t("widget.iconPosition")}
              value={el.layout}
              options={[
                { value: "side", label: t("widget.beside") },
                { value: "stack", label: t("widget.above") },
              ]}
              onChange={(layout) => set({ layout })}
            />
          </>
        )}
      </Section>
    </>
  );
}

function RingFields({ el, set }: { el: RingElement; set: Patch<RingElement> }) {
  const { t, i18n } = useTranslation("props");
  const longSide = useEditor((s) => Math.max(s.project.screen.width, s.project.screen.height));
  return (
    <Section title={t("section.ring")}>
      <FieldPicker label={t("common.shows")} value={el.valueType} options={ratioFields()} onChange={(def) => set({ valueType: def.id, name: i18n.t("editor:defaults.ring", { label: def.label }) })} />
      <SliderField label={t("ring.diameter")} value={el.size} min={48} max={Math.max(96, longSide)} unit="px" onChange={(size) => set({ size })} />
      <SliderField label={t("ring.thickness")} value={el.thickness} min={2} max={60} unit="px" onChange={(thickness) => set({ thickness })} />
      <SliderField label={t("ring.startAngle")} value={el.startAngle} min={0} max={359} unit="°" onChange={(startAngle) => set({ startAngle })} />
      <SliderField label={t("ring.sweep")} value={el.sweep} min={30} max={360} unit="°" onChange={(sweep) => set({ sweep })} />
      <ColorField label={t("ring.progressColor")} value={el.color} onChange={(color) => set({ color })} />
      <ColorField label={t("ring.trackColor")} value={el.trackColor} onChange={(trackColor) => set({ trackColor })} />
      <ToggleRow label={t("ring.roundedEnds")} checked={el.roundCap} onChange={(roundCap) => set({ roundCap })} />
    </Section>
  );
}

function IconSetFields({ el, set }: { el: IconSetElement; set: Patch<IconSetElement> }) {
  const { t, i18n } = useTranslation("props");
  return (
    <Section title={t("section.iconSet")}>
      <FieldPicker
        label={t("common.shows")}
        value={el.valueType}
        options={FIELDS.filter((f) => f.iconSet)}
        onChange={(def) => set({ valueType: def.id, name: i18n.t("editor:defaults.icons", { label: def.label }), color: def.color })}
      />
      <SliderField label={t("iconSet.size")} value={el.size} min={16} max={240} unit="px" onChange={(size) => set({ size })} />
      <ColorField label={t("common.color")} value={el.color} onChange={(color) => set({ color })} />
    </Section>
  );
}

export function PropertyPanel() {
  const { t } = useTranslation("props");
  const el = useEditor((s) => s.project.elements.find((e) => e.id === s.selectedId) ?? null);
  const updateElement = useEditor((s) => s.updateElement);
  const removeElement = useEditor((s) => s.removeElement);
  const duplicateElement = useEditor((s) => s.duplicateElement);
  const moveInStack = useEditor((s) => s.moveInStack);
  const stackIndex = useEditor((s) => s.project.elements.findIndex((e) => e.id === s.selectedId));
  const stackSize = useEditor((s) => s.project.elements.length);
  // Whether an image layer can be exported depends on its bitmap having loaded.
  useSyncExternalStore(subscribeAssets, assetsVersion);

  if (!el) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-bold">{t("empty.title")}</p>
        <p className="text-[0.8125rem] text-muted-foreground">{t("empty.hint")}</p>
      </div>
    );
  }
  const set = ((patch: Partial<Element>) => updateElement(el.id, patch)) as Patch<Element>;
  const support = elementSupport(el);

  return (
    <div className="space-y-4 p-4" data-testid="properties">
      <div className="flex items-center gap-2">
        <Input
          aria-label={t("layer.name")}
          value={el.name}
          onChange={(e) => set({ name: e.currentTarget.value })}
          className="h-9 min-w-0 flex-1 rounded-xl bg-muted px-3 text-sm font-bold"
        />
        {el.type !== "background" && (
          <>
            <Button variant="secondary" size="icon-sm" className="size-9" aria-label={t("layer.up")} title={t("layer.upTitle")} disabled={stackIndex >= stackSize - 1} onClick={() => moveInStack(el.id, 1)}>
              <ChevronUp />
            </Button>
            <Button variant="secondary" size="icon-sm" className="size-9" aria-label={t("layer.down")} title={t("layer.downTitle")} disabled={stackIndex <= 1} onClick={() => moveInStack(el.id, -1)}>
              <ChevronDown />
            </Button>
            <Button variant="secondary" size="icon-sm" className="size-9" aria-label={t("layer.duplicate")} title={t("layer.duplicateTitle")} onClick={() => duplicateElement(el.id)}>
              <Copy />
            </Button>
            <Button variant="destructive" size="icon-sm" className="size-9" aria-label={t("layer.delete")} title={t("layer.deleteTitle")} onClick={() => removeElement(el.id)}>
              <Trash2 />
            </Button>
          </>
        )}
      </div>
      <p className="px-0.5 text-xs font-semibold text-muted-foreground">{ELEMENT_LABELS[el.type]}</p>

      {support.level === "preview-only" && (
        <div className="flex gap-2.5 rounded-2xl bg-warning-soft p-3 text-[0.8125rem] text-foreground" role="note">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            <span className="font-bold">{t("notice.previewOnly")}</span> {support.note} {t("notice.previewOnlyBody")}
          </p>
        </div>
      )}
      {support.level === "experimental" && (
        <div className="flex gap-2.5 rounded-2xl bg-warning-soft p-3 text-[0.8125rem] text-foreground" role="note">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            <span className="font-bold">{t("notice.unconfirmed")}</span> {support.note || support.experimental.join(", ")} {t("notice.unconfirmedBody")}
          </p>
        </div>
      )}
      {support.level !== "preview-only" && support.dropped.length > 0 && (
        <div className="flex gap-2.5 rounded-2xl bg-warning-soft p-3 text-[0.8125rem] text-foreground" role="note">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            <span className="font-bold">{t("notice.droppedLead")}</span> {support.dropped.join(", ")}. {t("notice.droppedBody")}
          </p>
        </div>
      )}

      {el.type === "background" && <BackgroundFields el={el} set={set as Patch<BackgroundElement>} />}
      {el.type === "time" && <TimeFields el={el} set={set as Patch<TimeElement>} />}
      {el.type === "date" && <DateFields el={el} set={set as Patch<DateElement>} />}
      {el.type === "hand" && <HandFields el={el} set={set as Patch<HandElement>} />}
      {el.type === "image" && <ImageFields el={el} set={set as Patch<ImageElement>} />}
      {el.type === "widget" && <WidgetFields el={el} set={set as Patch<WidgetElement>} />}
      {el.type === "ring" && <RingFields el={el} set={set as Patch<RingElement>} />}
      {el.type === "iconset" && <IconSetFields el={el} set={set as Patch<IconSetElement>} />}
      {el.type !== "background" && <PositionFields el={el} set={set} pivot={el.type === "hand"} />}
    </div>
  );
}
