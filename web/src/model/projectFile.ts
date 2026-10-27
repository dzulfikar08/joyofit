import { i18n } from "@/i18n";
import { assetsToDataUrls, importAssetDataUrls } from "./assets";
import { LEGACY_RING_SOURCES, LEGACY_WIDGET_SOURCES, fieldDef } from "./fields";
import { parseScreen } from "./screens";
import { PROJECT_VERSION, type Element, type Project } from "./types";

/** `.json` project file: the project plus every uploaded image it uses, embedded as data URLs. */
export interface ProjectFile {
  format: "joyofit-studio-project";
  project: Project;
  assets: Record<string, { name: string; dataUrl: string }>;
}

export function assetIdsOf(project: Project): string[] {
  const ids = new Set<string>();
  for (const el of project.elements) {
    if (el.type === "image" || el.type === "hand") {
      if (el.assetId) ids.add(el.assetId);
    } else if (el.type === "background" && el.fill.kind === "image" && el.fill.assetId) {
      ids.add(el.fill.assetId);
    }
  }
  return [...ids];
}

export async function serializeProject(project: Project): Promise<string> {
  const file: ProjectFile = {
    format: "joyofit-studio-project",
    project,
    assets: await assetsToDataUrls(assetIdsOf(project)),
  };
  return JSON.stringify(file);
}

const ELEMENT_TYPES = new Set(["background", "time", "date", "hand", "image", "widget", "ring", "iconset"]);

function isElement(value: unknown): value is Element {
  if (typeof value !== "object" || value === null) return false;
  // Parsed JSON: the fields are checked one by one below.
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string" || typeof e.type !== "string" || !ELEMENT_TYPES.has(e.type) || typeof e.x !== "number" || typeof e.y !== "number") return false;
  // The data elements name a registry field by codec id; one the registry cannot draw would crash the renderer.
  if (e.type === "widget") return typeof e.valueType === "number" && fieldDef(e.valueType)?.number !== undefined;
  if (e.type === "ring") return typeof e.valueType === "number" && fieldDef(e.valueType)?.ratio !== undefined;
  if (e.type === "iconset") return typeof e.valueType === "number" && fieldDef(e.valueType)?.iconSet !== undefined;
  return true;
}

export class ProjectFileError extends Error {}

/** Projects written before the field registry stored `source: "steps"` and the like; the codec id replaces it. */
function migrateElement(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const { source, ...rest } = value as Record<string, unknown>;
  if (typeof source !== "string" || "valueType" in rest) return value;
  const table = rest.type === "widget" ? LEGACY_WIDGET_SOURCES : rest.type === "ring" ? LEGACY_RING_SOURCES : null;
  const valueType = table?.[source];
  return valueType === undefined ? value : { ...rest, valueType };
}

/**
 * Validates a project (from a file or from the autosave) and migrates old data elements. Throws `ProjectFileError` when the
 * project is not usable; every element is checked, so a damaged save cannot reach the renderer.
 */
export function restoreProject(raw: unknown): Project {
  if (typeof raw !== "object" || raw === null) throw new ProjectFileError(i18n.t("file.notProject"));
  const project = raw as Partial<Project>;
  if (project.version !== PROJECT_VERSION) {
    throw new ProjectFileError(i18n.t("file.version", { version: String(project.version), expected: PROJECT_VERSION }));
  }
  const elements = Array.isArray(project.elements) ? project.elements.map(migrateElement) : null;
  if (!elements || !elements.every(isElement)) throw new ProjectFileError(i18n.t("file.damaged"));
  return {
    version: PROJECT_VERSION,
    name: typeof project.name === "string" ? project.name : i18n.t("file.defaultName"),
    author: typeof project.author === "string" ? project.author : "",
    // Projects saved before screens existed have none: they were all made for the Watch Fit 4.
    screen: parseScreen(project.screen),
    elements,
  };
}

/** Parses and validates a project file, restores its images and returns the project. */
export async function parseProjectFile(text: string): Promise<Project> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError(i18n.t("file.notJson"));
  }
  const file = raw as Partial<ProjectFile>;
  if (file?.format !== "joyofit-studio-project" || typeof file.project !== "object" || file.project === null) {
    throw new ProjectFileError(i18n.t("file.notProject"));
  }
  const project = restoreProject(file.project);
  if (file.assets) await importAssetDataUrls(file.assets);
  return project;
}

export function downloadBlob(name: string, data: Blob | Uint8Array | string, type = "application/octet-stream"): void {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
