import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Download, FileJson, FileSearch, Loader2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { i18n } from "@/i18n";
import { hwtFileName } from "@/model/defaults";
import { downloadBlob, serializeProject } from "@/model/projectFile";
import { presetById, type ScreenSpec } from "@/model/screens";
import type { Project, Sim } from "@/model/types";
import { buildHwt, type ExportResult } from "@/export/build";
import { buildPhotoFace, type PhotoFaceResult } from "@/export/photo";
import { canSendPhotoFace, hwtTarget as hwtTargetOf } from "@/export/target";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { Segmented } from "@/ui/surface";
import { Switch } from "@/ui/switch";
import { cn } from "@/ui/utils";

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

type Target = "photo" | "hwt";
type State<T> = { status: "building" } | { status: "ready"; result: T } | { status: "failed"; message: string };

function Check({ ok, children, detail }: { ok: "ok" | "warn" | "error"; children: React.ReactNode; detail?: React.ReactNode }) {
  const Icon = ok === "ok" ? CircleCheck : ok === "warn" ? TriangleAlert : CircleAlert;
  return (
    <li className="flex gap-3 py-2">
      <Icon className={cn("mt-0.5 size-[1.125rem] shrink-0", ok === "ok" && "text-battery", ok === "warn" && "text-warning", ok === "error" && "text-destructive")} />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{children}</p>
        {detail && <p className="text-[0.8125rem] text-muted-foreground">{detail}</p>}
      </div>
    </li>
  );
}

function Failed({ message }: { message: string }) {
  const { t } = useTranslation("export");
  return (
    <div className="flex gap-2.5 rounded-2xl bg-destructive/10 p-3 text-sm" role="alert">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p>
        <span className="font-bold">{t("dialog.failedTitle")}</span> {message}
      </p>
    </div>
  );
}

function Building({ what }: { what: string }) {
  return (
    <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> {what}
    </p>
  );
}

/** Builds on open and whenever the project or the simulated state changes; resolves to the state of the latest build. */
function useBuild<T>(enabled: boolean, build: () => Promise<T>, deps: unknown[]): State<T> {
  const [state, setState] = useState<State<T>>({ status: "building" });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setState({ status: "building" });
    build().then(
      (result) => alive && setState({ status: "ready", result }),
      (err: unknown) => alive && setState({ status: "failed", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      alive = false;
    };
    // `build` closes over `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
  return state;
}

/** Whether the screen has been tried on a watch: a preset checked with JoyoFit, an untested preset, or a custom size. */
function ScreenStatus({ screen }: { screen: ScreenSpec }) {
  const { t } = useTranslation("export");
  const preset = presetById(screen.presetId);
  if (preset?.tested) return <Check ok="ok" detail={t("target.statusTestedDetail")}>{t("target.statusTested")}</Check>;
  if (preset) return <Check ok="warn" detail={t("target.statusUntestedDetail", { devices: preset.devices })}>{t("target.statusUntested")}</Check>;
  return <Check ok="warn" detail={t("target.statusCustomDetail")}>{t("target.statusCustom")}</Check>;
}

function PhotoChecklist({ result, screen, renamed }: { result: PhotoFaceResult; screen: ScreenSpec; renamed: boolean }) {
  const { t } = useTranslation("export");
  const sendsPhoto = canSendPhotoFace(screen);
  const included = result.layers.filter((l) => l.included);
  const problems = result.layers.filter((l) => !l.included && l.detail && !result.liveLeftOut.includes(l.name));
  const flagged = result.layers.filter((l) => l.included && l.detail);
  return (
    <ul className="divide-y divide-border" data-testid="checklist">
      <Check ok="ok" detail={sendsPhoto ? t("photo.sizeDetail") : t("photo.sizeDetailOther")}>
        {t("photo.size", { width: result.width, height: result.height })}
      </Check>
      <ScreenStatus screen={screen} />
      <Check ok={renamed ? "warn" : "ok"} detail={renamed ? t("photo.fileNameRenamed") : undefined}>
        {t("photo.fileName", { name: result.fileName })}
      </Check>
      <Check ok="ok" detail={t("photo.opaqueDetail")}>
        {t("photo.opaque")}
      </Check>
      <Check
        ok="ok"
        detail={included.length > 0 ? included.map((l) => l.name).join(", ") : t("photo.layersNone")}
      >
        {t(included.length === 1 ? "photo.layersOne" : "photo.layersOther", { count: included.length })}
      </Check>
      {result.liveLeftOut.length > 0 ? (
        <Check
          ok="warn"
          detail={t("photo.liveDetail", { names: result.liveLeftOut.join(", ") })}
        >
          {t(result.liveLeftOut.length === 1 ? "photo.liveOne" : "photo.liveOther", { count: result.liveLeftOut.length })}
        </Check>
      ) : (
        <Check ok="ok" detail={t("photo.noLiveDetail")}>
          {t("photo.noLive")}
        </Check>
      )}
      {problems.map((l) => (
        <Check key={l.id} ok="warn" detail={l.detail}>
          {t("photo.layerLeftOut", { name: l.name })}
        </Check>
      ))}
      {flagged.map((l) => (
        <Check key={l.id} ok="warn" detail={l.detail}>
          {l.name}
        </Check>
      ))}
      {sendsPhoto ? (
        <Check ok="ok" detail={t("photo.installDetail")}>
          {t("photo.install")}
        </Check>
      ) : (
        <Check ok="warn" detail={t("photo.notSentDetail")}>
          {t("photo.notSent")}
        </Check>
      )}
    </ul>
  );
}

function HwtChecklist({ result, screen, renamed }: { result: ExportResult; screen: ScreenSpec; renamed: boolean }) {
  const { t } = useTranslation("export");
  const preset = presetById(screen.presetId);
  const resolutionDetail = preset
    ? t("hwt.resolutionDetail", { code: result.target.code, devices: preset.devices })
    : t("hwt.resolutionDetailCustom", { code: result.target.code });
  const experimental = result.elements.filter((e) => e.exported && e.level === "experimental");
  const left = result.elements.filter((e) => !e.exported);
  const partial = result.elements.filter((e) => e.exported && e.dropped.length > 0);
  return (
    <ul className="divide-y divide-border" data-testid="checklist">
      <Check ok="warn" detail={t("hwt.unsignedDetail")}>
        {t("hwt.unsigned")}
      </Check>
      <Check ok={result.target.status === "tested" ? "ok" : "warn"} detail={resolutionDetail}>
        {t("hwt.resolution", { width: screen.width, height: screen.height })}
      </Check>
      <ScreenStatus screen={screen} />
      <Check ok={renamed ? "warn" : "ok"} detail={renamed ? t("hwt.fileNameRenamed") : undefined}>
        {t("hwt.fileName", { name: result.fileName })}
      </Check>
      <Check ok={result.stats.images > 200 ? "warn" : "ok"} detail={result.target.limitsKnown ? t("hwt.imagesDetail") : undefined}>
        {t("hwt.images", { count: result.stats.images, size: kb(result.stats.totalBytes) })}
      </Check>
      <Check ok={result.notes.some((n) => n.limit) ? "error" : "ok"} detail={result.target.limitsKnown ? t("hwt.largestDetail") : t("hwt.largestDetailUnknown")}>
        {t("hwt.largest", { largest: kb(result.stats.largestImageBytes), memory: kb(result.stats.imageMemoryBytes) })}
      </Check>
      <Check ok="ok" detail={t("hwt.aodDetail")}>
        {t("hwt.aod")}
      </Check>
      {left.map((e) => (
        <Check key={e.id} ok="warn" detail={e.detail}>
          {t("hwt.leftOut", { name: e.name })}
        </Check>
      ))}
      {experimental.map((e) => (
        <Check key={e.id} ok="warn" detail={e.detail}>
          {t("hwt.unconfirmedIds", { name: e.name })}
        </Check>
      ))}
      {partial.map((e) => (
        <Check key={e.id} ok="warn" detail={t("hwt.partialDetail", { parts: e.dropped.join(", ") })}>
          {t("hwt.partial", { name: e.name })}
        </Check>
      ))}
      {result.notes
        .filter((n) => !n.limit && !n.screenStatus)
        .map((n) => (
          <Check key={n.text} ok={n.level === "error" ? "error" : n.level === "warning" ? "warn" : "ok"}>
            {n.text}
          </Check>
        ))}
      {result.notes
        .filter((n) => n.limit)
        .map((n) => (
          <Check key={n.text} ok="error">
            {n.text}
          </Check>
        ))}
      <Check ok="warn" detail={t("hwt.layoutUnconfirmedDetail")}>
        {t("hwt.layoutUnconfirmed")}
      </Check>
    </ul>
  );
}

export function ExportDialog({ open, onClose, project, sim }: { open: boolean; onClose: () => void; project: Project; sim: Sim }) {
  const { t } = useTranslation("export");
  const [requested, setRequested] = useState<Target>("photo");
  const [includeExperimental, setIncludeExperimental] = useState(true);
  const hwtTarget = hwtTargetOf(project.screen);
  const target: Target = hwtTarget.ok ? requested : "photo";
  const setTarget = setRequested;
  const sendsPhoto = canSendPhotoFace(project.screen);

  const photo = useBuild(open && target === "photo", () => buildPhotoFace(project, sim), [project, sim]);
  const hwt = useBuild(open && target === "hwt", () => buildHwt(project, sim, { includeExperimental }), [project, sim, includeExperimental]);

  const fileBase = hwtFileName(project.name);
  const renamed = fileBase !== project.name.trim();
  const photoResult = photo.status === "ready" ? photo.result : null;
  const hwtResult = hwt.status === "ready" ? hwt.result : null;
  const hwtBlocked = !hwtResult || hwtResult.notes.some((n) => n.level === "error");

  const downloadPhoto = () => {
    if (!photoResult) return;
    downloadBlob(photoResult.fileName, photoResult.png, "image/png");
    toast.success(i18n.t("export:dialog.photoDownloaded", { file: photoResult.fileName }), {
      description: i18n.t(sendsPhoto ? "export:dialog.photoDownloadedHint" : "export:dialog.photoDownloadedOther"),
    });
  };
  const downloadHwt = () => {
    if (!hwtResult) return;
    downloadBlob(hwtResult.fileName, hwtResult.bytes, "application/octet-stream");
    toast.success(i18n.t("export:dialog.hwtDownloaded", { file: hwtResult.fileName }), { description: i18n.t("export:dialog.hwtDownloadedHint") });
  };
  const downloadDebug = () => {
    if (!hwtResult) return;
    downloadBlob(`${fileBase}.layout.json`, JSON.stringify(hwtResult.debug, null, 2), "application/json");
  };
  const downloadProject = async () => {
    downloadBlob(`${fileBase}.project.json`, await serializeProject(project), "application/json");
  };

  const experimental = hwtResult?.elements.filter((e) => e.exported && e.level === "experimental") ?? [];
  const state = target === "photo" ? photo : hwt;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("dialog.title")}
      description={t("dialog.description")}
      className="max-w-xl"
      testId="export-dialog"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => void downloadProject()} data-testid="export-project-json">
            <FileJson /> {t("dialog.projectJson")}
          </Button>
          {target === "hwt" && (
            <Button variant="ghost" size="sm" onClick={downloadDebug} disabled={!hwtResult} data-testid="export-debug">
              <FileSearch /> {t("dialog.debugLayout")}
            </Button>
          )}
          {target === "photo" ? (
            <Button onClick={downloadPhoto} disabled={!photoResult} data-testid="download-photo">
              {photo.status === "building" ? <Loader2 className="animate-spin" /> : <Download />}
              {t("dialog.downloadPhoto")}
            </Button>
          ) : (
            <Button onClick={downloadHwt} disabled={hwtBlocked} data-testid="download-hwt">
              {hwt.status === "building" ? <Loader2 className="animate-spin" /> : <Download />}
              {t("dialog.downloadHwt")}
            </Button>
          )}
        </>
      }
    >
      <Segmented
        label={t("dialog.target")}
        value={target}
        onChange={setTarget}
        className="mb-3"
        options={[
          { value: "photo", label: t("dialog.targetPhoto") },
          { value: "hwt", label: t("dialog.targetHwt"), disabled: !hwtTarget.ok },
        ]}
      />
      {!hwtTarget.ok && (
        <div className="mb-3 flex gap-2.5 rounded-2xl bg-muted p-3 text-sm" data-testid="hwt-unavailable">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <div>
            <p className="font-bold">{hwtTarget.reason}</p>
            <p className="text-[0.8125rem] text-muted-foreground">{t("target.noScreenCodeDetail")}</p>
          </div>
        </div>
      )}
      {state.status === "failed" && <Failed message={state.message} />}
      {state.status === "building" && <Building what={target === "photo" ? t("dialog.buildingPhoto") : t("dialog.buildingHwt")} />}
      {target === "photo" && photoResult && <PhotoChecklist result={photoResult} screen={project.screen} renamed={renamed} />}
      {target === "hwt" && hwtResult && (
        <>
          <HwtChecklist result={hwtResult} screen={project.screen} renamed={renamed} />
          <div className="mt-3 flex items-center justify-between gap-4 rounded-2xl bg-muted p-4">
            <div className="min-w-0">
              <p className="text-sm font-bold">{t("dialog.includeExperimental")}</p>
              <p className="text-[0.8125rem] text-muted-foreground" data-testid="experimental-summary">
                {experimental.length > 0
                  ? t("dialog.experimentalNamed", { names: experimental.map((e) => e.name).join(", ") })
                  : t("dialog.experimentalGeneric")}
              </p>
            </div>
            <Switch label={t("dialog.includeExperimental")} checked={includeExperimental} onCheckedChange={setIncludeExperimental} />
          </div>
        </>
      )}
    </Dialog>
  );
}
