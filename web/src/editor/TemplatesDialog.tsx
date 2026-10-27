import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { emptyProject } from "@/model/defaults";
import { presetById, type ScreenSpec } from "@/model/screens";
import type { Project } from "@/model/types";
import type { Ctx2D } from "@/render/canvas";
import { drawProject } from "@/render/scene";
import { screenPath, screenPathData } from "@/render/shapes";
import { defaultSim } from "@/render/values";
import { TEMPLATES, type Template } from "@/templates";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { cn } from "@/ui/utils";
import { ScreenDialog, ScreenOutline, screenName } from "./ScreenDialog";
import { useEditor } from "./store";

const sim = defaultSim();

/** Canvas pixels per screen pixel for the card previews. */
const PREVIEW_SCALE = 0.75;

const screenKey = (s: ScreenSpec) => `${s.presetId ?? "custom"}:${s.width}x${s.height}:${s.shape}:${s.cornerRadius}`;

/** The face (or a black screen while there is none) in the screen's own shape and aspect ratio; `children` sit over its middle. */
function Preview({ screen, project, children }: { screen: ScreenSpec; project: Project | null; children?: ReactNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const outline = useMemo(() => screenPathData(screen), [screen]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(canvas.width / screen.width, 0, 0, canvas.height / screen.height, 0, 0);
    ctx.clearRect(0, 0, screen.width, screen.height);
    ctx.save();
    ctx.clip(screenPath(screen));
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, screen.width, screen.height);
    ctx.imageSmoothingQuality = "high";
    if (project) drawProject(ctx as Ctx2D, project, sim);
    ctx.restore();
  }, [project, screen]);
  return (
    <div className="relative mx-auto h-42" style={{ aspectRatio: `${screen.width} / ${screen.height}` }}>
      <canvas ref={ref} width={Math.round(screen.width * PREVIEW_SCALE)} height={Math.round(screen.height * PREVIEW_SCALE)} className="size-full" />
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full text-foreground/15" viewBox={`0 0 ${screen.width} ${screen.height}`} preserveAspectRatio="none">
        <path d={outline} fill="none" stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center text-xs font-semibold text-white/50">{children}</div>}
    </div>
  );
}

function Card({ template, screen, project, onPick }: { template: Template | null; screen: ScreenSpec; project: Project | null; onPick: () => void }) {
  const { t } = useTranslation("templates");
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={template !== null && project === null}
      aria-busy={template !== null && project === null}
      data-testid={`template-${template?.id ?? "blank"}`}
      className={cn(
        "pressable flex flex-col items-stretch gap-3 rounded-2xl bg-muted p-3 text-left transition-colors duration-150 disabled:cursor-progress disabled:opacity-70 hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)] focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
      )}
    >
      <Preview screen={screen} project={project}>
        {!project && (template ? <Loader2 className="size-4 animate-spin" /> : t("empty"))}
      </Preview>
      <span>
        <span className="block text-sm font-bold">{template?.name ?? t("blank.name")}</span>
        <span className="block text-[0.8125rem] text-muted-foreground">{template?.blurb ?? t("blank.blurb")}</span>
      </span>
    </button>
  );
}

export function TemplatesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation("templates");
  const { t: ts } = useTranslation("screen");
  const loadProject = useEditor((s) => s.loadProject);
  const current = useEditor((s) => s.project.screen);
  // The screen the new face is made for: the open face's, until another is picked here.
  const [screen, setScreen] = useState<ScreenSpec>(current);
  const [picking, setPicking] = useState(false);
  const [built, setBuilt] = useState<Record<string, Project>>({});
  const builtRef = useRef(built);
  builtRef.current = built;
  const key = screenKey(screen);

  useEffect(() => {
    if (open) setScreen(current);
    // Each opening starts from the face's screen as it is then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      for (const tpl of TEMPLATES) {
        const id = `${key}|${tpl.id}`;
        if (builtRef.current[id]) continue;
        try {
          const p = await tpl.build(screen);
          if (alive) setBuilt((b) => ({ ...b, [id]: p }));
        } catch {
          // A template that fails to build simply stays a spinner; the others still work.
        }
      }
    })();
    return () => {
      alive = false;
    };
    // `built` only grows; re-running on its change would rebuild nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  const apply = (project: Project, name: string) => {
    loadProject(project);
    onClose();
    toast.success(t("loaded", { name }), { description: t("loadedHint") });
  };

  const preset = presetById(screen.presetId);

  return (
    <>
      <Dialog open={open} onClose={onClose} title={t("title")} description={t("description")} className="max-w-3xl" testId="templates-dialog">
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-muted p-3">
          <ScreenOutline screen={screen} scale={32 / Math.max(screen.width, screen.height)} className="text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-muted-foreground">{ts("templates.label")}</p>
            <p className="text-sm font-bold" data-testid="templates-screen-name">
              {screenName(screen, ts("custom"))} <span className="font-semibold text-foreground/80 tabular-nums">{ts("size", { width: screen.width, height: screen.height })}</span>
            </p>
            {!preset?.tested && <p className="text-xs text-muted-foreground">{ts("untested")}</p>}
          </div>
          <Button variant="secondary" size="sm" onClick={() => setPicking(true)} data-testid="templates-screen">
            {ts("templates.change")}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-1 pb-2 sm:grid-cols-3">
          {TEMPLATES.map((tpl) => {
            const project = built[`${key}|${tpl.id}`] ?? null;
            return <Card key={tpl.id} template={tpl} screen={screen} project={project} onPick={() => project && apply(project, tpl.name)} />;
          })}
          <Card template={null} screen={screen} project={null} onPick={() => apply(emptyProject(undefined, screen), t("blank.name"))} />
        </div>
      </Dialog>
      <ScreenDialog open={picking} onClose={() => setPicking(false)} value={screen} askFit={false} onPick={(next) => setScreen(next)} testId="templates-screen-dialog" />
    </>
  );
}
