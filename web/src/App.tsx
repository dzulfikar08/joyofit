import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CircleHelp, Download, FolderOpen, LayoutTemplate, Moon, Redo2, Save, Sun, Undo2 } from "lucide-react";
import { Toaster, toast } from "sonner";
import { i18n } from "@/i18n";
import { LanguageSwitch } from "@/i18n/LanguageSwitch";
import { ExportDialog } from "@/editor/ExportDialog";
import { HelpDialog } from "@/editor/HelpDialog";
import { LayerPanel } from "@/editor/LayerPanel";
import { PropertyPanel } from "@/editor/PropertyPanel";
import { SimPanel, StageControls } from "@/editor/SimPanel";
import { Stage, useStageZoom } from "@/editor/Stage";
import { ScreenDialog, ScreenOutline, screenName } from "@/editor/ScreenDialog";
import { TemplatesDialog } from "@/editor/TemplatesDialog";
import { liveAssetIds, startAutosave, useEditor } from "@/editor/store";
import { useShortcuts } from "@/editor/shortcuts";
import { CloudButton } from "@/cloud/CloudButton";
import { CloudDialog } from "@/cloud/CloudDialog";
import { startCloudSync } from "@/cloud/sync";
import { loadProjectAssets } from "@/model/assets";
import { assetIdsOf, downloadBlob, parseProjectFile, ProjectFileError, serializeProject } from "@/model/projectFile";
import { hwtFileName } from "@/model/defaults";
import { sameScreen } from "@/model/screens";
import { Button, buttonVariants } from "@/ui/button";
import { Input } from "@/ui/input";
import { cn } from "@/ui/utils";

const HELP_SEEN = "joyofit-studio:help-seen";
/** JoyoFit Web (apps/fit) keeps its theme here ("light" | "dark" | "system") on the same origin, so one toggle serves both. */
const THEME_KEY = "vite-ui-theme";
const WEB_HOST = "app.fit.joyorogo.com";
/** The JoyoFit web app is the root of the host Studio is mounted on; elsewhere (workers.dev, localhost) it is the live site. */
const WEB_URL = location.hostname === WEB_HOST ? "/" : `https://${WEB_HOST}/`;
const AUTOSAVE_TOAST = "autosave-failed";
type Panel = "layers" | "preview" | "properties";

function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return saved === "dark" || saved === "light" ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return [
    dark,
    () => {
      // Flipping every color at once would smear through their transitions; switch them off for the frame.
      const style = document.createElement("style");
      style.textContent = "*,*::before,*::after{transition:none !important}";
      document.head.append(style);
      setDark((d) => {
        try {
          localStorage.setItem(THEME_KEY, d ? "light" : "dark");
        } catch {
          // Theme still switches for this session.
        }
        return !d;
      });
      requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
    },
  ];
}

/** The JoyoFit ring mark and wordmark of the web app (apps/fit brand-mark.tsx), with a Studio pill where the web app has "Web". */
function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 1024 1024" className="size-8 shrink-0" aria-hidden>
        <path d="M512 250A262 262 0 1 1 285.1 643" fill="none" strokeWidth="120" strokeLinecap="round" className="stroke-primary" />
        <circle cx="255.73" cy="457.53" r="74" className="fill-[#2BA3C4] dark:fill-[#BFE7F3]" />
      </svg>
      <span className="hidden items-center gap-2 sm:flex">
        <span className="text-lg font-extrabold tracking-tight">JoyoFit</span>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.6875rem] font-bold tracking-wide text-primary uppercase">Studio</span>
      </span>
    </div>
  );
}

function StageArea() {
  const holder = useRef<HTMLDivElement>(null);
  const screen = useEditor((s) => s.project.screen);
  const zoom = useStageZoom(holder, screen);
  return (
    <div ref={holder} className="relative min-h-0 flex-1 overflow-hidden rounded-3xl bg-stage">
      <StageControls currentZoom={zoom} />
      <Stage zoom={zoom} />
    </div>
  );
}

export function App() {
  const project = useEditor((s) => s.project);
  const sim = useEditor((s) => s.sim);
  const patchProject = useEditor((s) => s.patchProject);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const loadProject = useEditor((s) => s.loadProject);
  const setScreen = useEditor((s) => s.setScreen);
  const hasLayers = useEditor((s) => s.project.elements.some((e) => e.type !== "background"));

  const [help, setHelp] = useState(() => {
    try {
      return !localStorage.getItem(HELP_SEEN);
    } catch {
      return true;
    }
  });
  const [templates, setTemplates] = useState(false);
  const [screenOpen, setScreenOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [cloud, setCloud] = useState(false);
  const [panel, setPanel] = useState<Panel>("preview");
  // Below lg the panel is collapsed so the preview keeps its height; from lg up it is always shown.
  const [simOpen, setSimOpen] = useState(false);
  const [dark, toggleTheme] = useTheme();
  const openInput = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const { t: ts } = useTranslation("screen");

  useEffect(() => {
    void loadProjectAssets(assetIdsOf(useEditor.getState().project), { liveIds: liveAssetIds });
    return startAutosave((status) => {
      if (status.ok) toast.dismiss(AUTOSAVE_TOAST);
      else {
        toast.error(i18n.t("toast.autosaveFailed"), {
          id: AUTOSAVE_TOAST,
          duration: Infinity,
          description: i18n.t("toast.autosaveFailedBody"),
        });
      }
    });
  }, []);
  useEffect(
    () =>
      startCloudSync(() => {
        toast.error(i18n.t("cloud:toast.conflict"), { id: "cloud-conflict", action: { label: i18n.t("cloud:toast.conflictAction"), onClick: () => setCloud(true) } });
      }),
    [],
  );
  useShortcuts(!help && !templates && !screenOpen && !exporting && !cloud);

  const closeHelp = () => {
    setHelp(false);
    try {
      localStorage.setItem(HELP_SEEN, "1");
    } catch {
      // The help simply shows again next visit.
    }
  };

  const saveProject = async () => {
    downloadBlob(`${hwtFileName(project.name)}.project.json`, await serializeProject(project), "application/json");
  };

  const openProject = async (file: File) => {
    try {
      loadProject(await parseProjectFile(await file.text()));
      toast.success(t("toast.opened", { name: file.name }));
    } catch (err) {
      toast.error(err instanceof ProjectFileError ? err.message : t("toast.openFailed"));
    }
  };

  const iconBtn = "size-10";
  const screenSize = ts("size", { width: project.screen.width, height: project.screen.height });

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      {/* Below lg the face name and the file/theme buttons move to a second row (order-2, after the line break) so the header never overflows. */}
      <header className="flex flex-wrap items-center gap-1 px-1 sm:gap-2">
        <a
          href={WEB_URL}
          data-testid="back-to-web"
          aria-label={t("header.backToWeb")}
          title={t("header.backToWeb")}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-10 max-2xl:size-10 max-2xl:px-0")}
        >
          <ArrowLeft />
          <span className="max-2xl:hidden">{t("header.backToWeb")}</span>
        </a>
        <Logo />
        <div aria-hidden className="order-1 -my-0.5 basis-full sm:-my-1 lg:hidden" />
        <Input
          aria-label={t("header.faceName")}
          data-testid="face-name"
          value={project.name}
          maxLength={40}
          onChange={(e) => patchProject({ name: e.currentTarget.value })}
          className="h-10 min-w-0 flex-1 rounded-full px-4 text-sm font-bold max-lg:order-2 lg:ml-1 lg:w-40 lg:flex-none xl:w-56"
        />
        <div className="ml-1 flex">
          <Button variant="ghost" size="icon" className={iconBtn} aria-label={t("header.undo")} title={t("header.undoHint")} disabled={!canUndo} onClick={undo}>
            <Undo2 />
          </Button>
          <Button variant="ghost" size="icon" className={iconBtn} aria-label={t("header.redo")} title={t("header.redoHint")} disabled={!canRedo} onClick={redo}>
            <Redo2 />
          </Button>
        </div>
        <div className="flex-1" />
        <LanguageSwitch className={cn(iconBtn, "max-sm:order-2")} />
        <Button
          variant="secondary"
          size="sm"
          className="h-10"
          onClick={() => setScreenOpen(true)}
          data-testid="open-screen"
          aria-label={ts("header.label", { name: screenName(project.screen, ts("custom")), size: screenSize })}
          title={ts("title")}
        >
          <ScreenOutline screen={project.screen} scale={16 / Math.max(project.screen.width, project.screen.height)} />
          <span className="hidden tabular-nums md:inline">{screenSize}</span>
          <span className="hidden 2xl:inline">{screenName(project.screen, ts("custom"))}</span>
        </Button>
        <Button variant="secondary" size="sm" className="h-10" onClick={() => setTemplates(true)} data-testid="open-templates" aria-label={t("header.templates")} title={t("header.templates")}>
          <LayoutTemplate />
          <span className="hidden md:inline lg:hidden xl:inline">{t("header.templates")}</span>
        </Button>
        <input
          ref={openInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (f) void openProject(f);
          }}
        />
        <Button variant="ghost" size="icon" className={cn(iconBtn, "max-lg:order-2")} aria-label={t("header.openFile")} title={t("header.openFile")} onClick={() => openInput.current?.click()}>
          <FolderOpen />
        </Button>
        <Button variant="ghost" size="icon" className={cn(iconBtn, "max-lg:order-2")} aria-label={t("header.saveFile")} title={t("header.saveFile")} onClick={() => void saveProject()}>
          <Save />
        </Button>
        <CloudButton className={cn(iconBtn, "max-lg:order-2")} onClick={() => setCloud(true)} />
        <Button variant="ghost" size="icon" className={cn(iconBtn, "max-lg:order-2")} aria-label={dark ? t("header.themeLight") : t("header.themeDark")} title={dark ? t("header.themeLight") : t("header.themeDark")} onClick={toggleTheme}>
          {dark ? <Sun /> : <Moon />}
        </Button>
        <Button variant="ghost" size="icon" className={iconBtn} aria-label={t("header.help")} title={t("header.help")} onClick={() => setHelp(true)} data-testid="open-help">
          <CircleHelp />
        </Button>
        <Button className="h-10 px-3 sm:px-4" onClick={() => setExporting(true)} data-testid="export-open" aria-label={t("header.export")}>
          <Download />
          <span className="max-sm:hidden">{t("header.exportShort")}</span>
        </Button>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[17rem_minmax(0,1fr)_21rem]">
        <aside className={cn("min-h-0 overflow-hidden rounded-3xl bg-card", panel === "layers" ? "block" : "hidden lg:block")} aria-label={t("panel.layers")}>
          <LayerPanel />
        </aside>

        <section className={cn("min-h-0 flex-col gap-3", panel === "preview" ? "flex" : "hidden lg:flex")} aria-label={t("panel.preview")}>
          <StageArea />
          <div className="shrink-0 rounded-3xl bg-card">
            <button
              type="button"
              aria-expanded={simOpen}
              onClick={() => setSimOpen((o) => !o)}
              className="flex w-full items-center justify-between rounded-3xl px-5 py-3 text-left text-sm font-bold lg:hidden"
            >
              {t("sim.title")}
              <span className="text-xs font-semibold text-muted-foreground">{simOpen ? t("sim.hide") : t("sim.show")}</span>
            </button>
            <div className={cn(simOpen ? "block" : "hidden", "lg:block")}>
              <SimPanel />
            </div>
          </div>
        </section>

        <aside className={cn("min-h-0 overflow-y-auto rounded-3xl bg-card", panel === "properties" ? "block" : "hidden lg:block")} aria-label={t("panel.properties")}>
          <PropertyPanel />
        </aside>
      </main>

      <nav className="grid grid-cols-3 gap-1 rounded-full bg-card p-1 lg:hidden" aria-label={t("panel.nav")}>
        {(["layers", "preview", "properties"] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={panel === p}
            onClick={() => setPanel(p)}
            className={cn(
              "h-10 rounded-full text-sm font-semibold transition-colors duration-150",
              panel === p ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {t(`panel.${p}`)}
          </button>
        ))}
      </nav>

      <HelpDialog open={help} onClose={closeHelp} />
      <TemplatesDialog open={templates} onClose={() => setTemplates(false)} />
      <ScreenDialog
        open={screenOpen}
        onClose={() => setScreenOpen(false)}
        value={project.screen}
        askFit={hasLayers}
        onPick={(screen, fit) => {
          if (sameScreen(screen, project.screen)) return;
          setScreen(screen, fit);
          toast.success(ts("changed", { name: screenName(screen, ts("custom")) }), { description: ts("changedHint") });
        }}
      />
      <CloudDialog open={cloud} onClose={() => setCloud(false)} />
      <ExportDialog open={exporting} onClose={() => setExporting(false)} project={project} sim={sim} />
      <Toaster position="bottom-center" theme={dark ? "dark" : "light"} />
    </div>
  );
}
