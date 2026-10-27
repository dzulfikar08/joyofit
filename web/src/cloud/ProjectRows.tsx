import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, FolderOpen, LoaderCircle, Pencil, Trash2, Watch, X } from "lucide-react";
import { intlLocale } from "@/i18n";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { cn } from "@/ui/utils";
import { NAME_MAX, type CloudList, type CloudMeta } from "./api";
import { formatBytes, formatUpdated } from "./format";

interface Props {
  list: CloudList | null;
  /** The list could not be loaded: the message to show instead of it. */
  listError: string | null;
  onRetry: () => void;
  /** The cloud project the open face is linked to. */
  linkedId: string | null;
  /** Renaming needs Pro; opening and deleting never do. */
  canWrite: boolean;
  /** The row an action is running on. */
  busyId: string | null;
  /** Some cloud action is running: no second one starts. */
  disabled: boolean;
  onOpen: (meta: CloudMeta) => void;
  onRename: (meta: CloudMeta, name: string) => void;
  onDelete: (meta: CloudMeta) => void;
}

/** A fixed box the picture sits in whole: the thumbnail has the aspect of the face's screen (band, round, squircle), so it is contained, not cropped. */
function Thumb({ meta }: { meta: CloudMeta }) {
  return (
    <div className="relative grid aspect-[408/480] w-12 shrink-0 self-start place-items-center overflow-hidden rounded-xl bg-stage text-stage-muted" data-testid={`cloud-thumb-${meta.id}`}>
      {meta.thumb ? <img src={meta.thumb} alt="" className="absolute inset-0 size-full object-contain" /> : <Watch className="size-5" aria-hidden />}
    </div>
  );
}

function Row({ meta, linked, canWrite, busy, disabled, onOpen, onRename, onDelete }: Omit<Props, "list" | "listError" | "onRetry" | "linkedId" | "busyId"> & { meta: CloudMeta; linked: boolean; busy: boolean }) {
  const { t } = useTranslation("cloud");
  const locale = intlLocale();
  const [name, setName] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const commit = () => {
    const next = (name ?? "").trim();
    setName(null);
    if (next && next !== meta.name) onRename(meta, next);
  };

  return (
    <li className="flex gap-3 rounded-2xl bg-muted/60 p-2.5" data-testid={`cloud-row-${meta.id}`} data-linked={linked || undefined}>
      <Thumb meta={meta} />
      <div className="min-w-0 flex-1 space-y-1.5">
        {name === null ? (
          <div className="min-w-0">
            <p className="flex items-center gap-2">
              <span className="truncate text-sm font-bold" title={meta.name} data-testid={`cloud-name-${meta.id}`}>
                {meta.name}
              </span>
              {linked && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-primary">{t("list.open")}</span>}
              {busy && <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {formatBytes(meta.size, locale)} · {formatUpdated(meta.updatedAt, Date.now(), locale)}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              aria-label={t("list.renameLabel")}
              data-testid={`cloud-rename-input-${meta.id}`}
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                } else if (e.key === "Escape") {
                  // Escape closes a native dialog; here it only leaves the field.
                  e.preventDefault();
                  e.stopPropagation();
                  setName(null);
                }
              }}
              className="h-10 flex-1 rounded-full px-3 text-sm font-bold"
            />
            <Button variant="ghost" size="icon-sm" aria-label={t("list.renameSave")} title={t("list.renameSave")} onClick={commit}>
              <Check />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={t("list.renameCancel")} title={t("list.renameCancel")} onClick={() => setName(null)}>
              <X />
            </Button>
          </div>
        )}

        {confirming ? (
          <div className="space-y-2" role="alertdialog" aria-label={t("list.deleteConfirm", { name: meta.name })} data-testid={`cloud-delete-confirm-${meta.id}`}>
            <p className="text-[0.8125rem] break-words">{t("list.deleteConfirm", { name: meta.name })}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={disabled}
                onClick={() => {
                  setConfirming(false);
                  onDelete(meta);
                }}
                data-testid={`cloud-delete-yes-${meta.id}`}
              >
                {t("list.delete")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                {t("list.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          name === null && (
            <div className="flex flex-wrap items-center gap-1">
              <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onOpen(meta)} aria-label={t("list.openLabel", { name: meta.name })} data-testid={`cloud-open-${meta.id}`}>
                <FolderOpen />
                {t("list.openAction")}
              </Button>
              <Button variant="ghost" size="icon-sm" disabled={disabled || !canWrite} aria-label={t("list.renameAction", { name: meta.name })} title={t("list.renameTitle")} onClick={() => setName(meta.name)} data-testid={`cloud-rename-${meta.id}`}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={t("list.deleteAction", { name: meta.name })} title={t("list.delete")} onClick={() => setConfirming(true)} data-testid={`cloud-delete-${meta.id}`}>
                <Trash2 />
              </Button>
            </div>
          )
        )}
      </div>
    </li>
  );
}

export function ProjectRows({ list, listError, onRetry, linkedId, busyId, ...rest }: Props) {
  const { t } = useTranslation("cloud");

  if (listError) {
    return (
      <div className="space-y-3" data-testid="cloud-list-error">
        <p role="alert" className="rounded-2xl bg-destructive/10 p-3 text-[0.8125rem]">
          {listError}
        </p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t("retry")}
        </Button>
      </div>
    );
  }
  if (!list) return null;

  return (
    <section className="space-y-2" aria-label={t("list.title")}>
      <h3 className="text-sm font-bold" data-testid="cloud-count">
        {t("list.count", { count: list.projects.length, max: list.max })}
      </h3>
      {list.projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-5 text-center" data-testid="cloud-empty">
          <p className="text-sm font-semibold">{t("list.emptyTitle")}</p>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">{t("list.emptyBody")}</p>
        </div>
      ) : (
        <ul className={cn("space-y-2")} data-testid="cloud-list">
          {list.projects.map((meta) => (
            <Row key={meta.id} meta={meta} linked={meta.id === linkedId} busy={meta.id === busyId} {...rest} />
          ))}
        </ul>
      )}
    </section>
  );
}
