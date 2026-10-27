import { create } from "zustand";
import { i18n } from "@/i18n";
import { retainAssets } from "@/model/assets";
import { emptyProject, newElement, uid } from "@/model/defaults";
import { fitElements } from "@/model/fit";
import { assetIdsOf, restoreProject } from "@/model/projectFile";
import { DEFAULT_SCREEN, sameScreen, type ScreenSize, type ScreenSpec } from "@/model/screens";
import type { Element, ElementType, Project, Sim } from "@/model/types";
import { elementBounds } from "@/render/scene";
import { defaultSim } from "@/render/values";

export const STORAGE_KEY = "joyofit-studio:project:v1";
const HISTORY_LIMIT = 100;
const COALESCE_MS = 700;
const AUTOSAVE_MS = 300;

export interface EditorState {
  project: Project;
  selectedId: string | null;
  past: Project[];
  future: Project[];
  sim: Sim;
  /** `fit` fills the stage; a number is an explicit zoom factor. */
  zoom: "fit" | number;
  snapping: boolean;
  /** Stage shows only the layers a photo face carries (pictures), not the live ones the watch draws itself. */
  photoPreview: boolean;
  /** Last coalesced edit, so a slider drag becomes one undo step. */
  lastEdit: { key: string; at: number } | null;
  /** True while a pointer gesture (move, scale, pan) is in progress. */
  dragging: boolean;
  /** The project when the gesture began. It becomes the undo step on the gesture's first real change; a bare click never does. */
  dragOrigin: Project | null;

  select: (id: string | null) => void;
  setSim: (patch: Partial<Sim>) => void;
  setZoom: (zoom: "fit" | number) => void;
  setSnapping: (on: boolean) => void;
  setPhotoPreview: (on: boolean) => void;

  commit: (next: Project, coalesceKey?: string) => void;
  patchProject: (patch: Partial<Pick<Project, "name" | "author">>, coalesceKey?: string) => void;
  addElement: (type: ElementType) => void;
  /** Adds an element drawn for the Watch Fit 4 screen: it is fitted to the project's screen on the way in. */
  addCustom: (el: Element) => void;
  updateElement: (id: string, patch: Partial<Element>, coalesceKey?: string) => void;
  removeElement: (id: string) => void;
  duplicateElement: (id: string) => void;
  /** Move an element within the stack (positive = towards the top). */
  moveInStack: (id: string, delta: number) => void;
  reorder: (id: string, toIndex: number) => void;

  beginDrag: () => void;
  endDrag: () => void;

  undo: () => void;
  redo: () => void;
  loadProject: (project: Project) => void;
  /**
   * Gives the face another screen in one undo step. `scale` fits the design to the new size (uniform scale by the smaller ratio,
   * centred, see `fitElements`); `keep` leaves every element where it is.
   */
  setScreen: (screen: ScreenSpec, fit: "scale" | "keep") => void;
}

function normalise(project: Project): Project {
  // The background is always the bottom layer and there is only one.
  const bg = project.elements.filter((e) => e.type === "background");
  const rest = project.elements.filter((e) => e.type !== "background");
  return { ...project, elements: [...bg.slice(0, 1), ...rest] };
}

/** New text-like elements land centred left to right; their width is only known once laid out. */
function centredHorizontally(el: Element, sim: Sim, screen: ScreenSize): Element {
  if (el.type !== "time" && el.type !== "date" && el.type !== "widget") return el;
  const b = elementBounds(el, sim);
  return { ...el, x: Math.round((screen.width - b.w) / 2) };
}

/** What the autosave held at start: nothing, a project that restored, or an entry that did not restore (its JSON is still in storage). */
export type SavedState = { kind: "none" } | { kind: "restored"; project: Project } | { kind: "rejected" };

export function readSavedState(storage?: Pick<Storage, "getItem">): SavedState {
  let raw: string | null;
  try {
    raw = (storage ?? localStorage).getItem(STORAGE_KEY);
  } catch {
    return { kind: "none" };
  }
  if (!raw) return { kind: "none" };
  try {
    return { kind: "restored", project: restoreProject(JSON.parse(raw)) };
  } catch {
    return { kind: "rejected" };
  }
}

/** The autosaved project, or null when there is none or it does not pass the same checks as a project file. */
export function readSaved(storage?: Pick<Storage, "getItem">): Project | null {
  const saved = readSavedState(storage);
  return saved.kind === "restored" ? saved.project : null;
}

const saved = readSavedState();

export const useEditor = create<EditorState>((set, get) => ({
  project: saved.kind === "restored" ? saved.project : emptyProject(),
  selectedId: null,
  past: [],
  future: [],
  sim: defaultSim(),
  zoom: "fit",
  snapping: true,
  photoPreview: false,
  lastEdit: null,
  dragging: false,
  dragOrigin: null,

  select: (id) => set({ selectedId: id }),
  setSim: (patch) => set((s) => ({ sim: { ...s.sim, ...patch } })),
  setZoom: (zoom) => set({ zoom }),
  setSnapping: (snapping) => set({ snapping }),
  setPhotoPreview: (photoPreview) => set({ photoPreview }),

  commit: (next, coalesceKey) => {
    const s = get();
    const now = Date.now();
    const project = normalise(next);
    if (s.dragging) {
      // The first real change of a gesture records the state the gesture started from; later ones only move the element.
      const first = s.dragOrigin !== null;
      set({
        project,
        past: first ? [...s.past, s.dragOrigin!].slice(-HISTORY_LIMIT) : s.past,
        future: first ? [] : s.future,
        dragOrigin: null,
        lastEdit: null,
      });
      return;
    }
    const coalesce = coalesceKey && s.lastEdit?.key === coalesceKey && now - s.lastEdit.at < COALESCE_MS;
    set({
      project,
      past: coalesce ? s.past : [...s.past, s.project].slice(-HISTORY_LIMIT),
      future: coalesce ? s.future : [],
      lastEdit: coalesceKey ? { key: coalesceKey, at: now } : null,
    });
  },

  patchProject: (patch, coalesceKey) => get().commit({ ...get().project, ...patch }, coalesceKey ?? `project:${Object.keys(patch).join()}`),

  addElement: (type) => get().addCustom(newElement(type)),

  addCustom: (el) => {
    const { project, sim } = get();
    const [fitted] = fitElements([el], DEFAULT_SCREEN, project.screen);
    const placed = centredHorizontally(fitted!, sim, project.screen);
    get().commit({ ...project, elements: [...project.elements, placed] });
    set({ selectedId: placed.id });
  },

  updateElement: (id, patch, coalesceKey) => {
    const { project } = get();
    const target = project.elements.find((e) => e.id === id);
    // Setting what is already there (a pointer that did not move, a slider at its value) is not an edit.
    if (!target || Object.entries(patch).every(([key, value]) => Object.is(target[key as keyof Element], value))) return;
    const elements = project.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as Element) : e));
    get().commit({ ...project, elements }, coalesceKey ?? `el:${id}:${Object.keys(patch).join()}`);
  },

  removeElement: (id) => {
    const { project, selectedId } = get();
    const target = project.elements.find((e) => e.id === id);
    if (!target || target.type === "background") return;
    get().commit({ ...project, elements: project.elements.filter((e) => e.id !== id) });
    if (selectedId === id) set({ selectedId: null });
  },

  duplicateElement: (id) => {
    const { project } = get();
    const index = project.elements.findIndex((e) => e.id === id);
    const src = project.elements[index];
    if (!src || src.type === "background") return;
    const copy = { ...src, id: uid(), name: i18n.t("editor:copyName", { name: src.name }), x: src.x + 12, y: src.y + 12 } as Element;
    const elements = [...project.elements];
    elements.splice(index + 1, 0, copy);
    get().commit({ ...project, elements });
    set({ selectedId: copy.id });
  },

  moveInStack: (id, delta) => {
    const { project } = get();
    const index = project.elements.findIndex((e) => e.id === id);
    if (index < 0) return;
    get().reorder(id, index + delta);
  },

  reorder: (id, toIndex) => {
    const { project } = get();
    const from = project.elements.findIndex((e) => e.id === id);
    if (from < 0 || project.elements[from]?.type === "background") return;
    const to = Math.max(1, Math.min(project.elements.length - 1, toIndex));
    if (to === from) return;
    const elements = [...project.elements];
    const [moved] = elements.splice(from, 1);
    elements.splice(to, 0, moved!);
    get().commit({ ...project, elements });
  },

  beginDrag: () => {
    const s = get();
    if (s.dragging) return;
    set({ dragging: true, dragOrigin: s.project, lastEdit: null });
  },
  endDrag: () => set({ dragging: false, dragOrigin: null }),

  undo: () => {
    const s = get();
    const previous = s.past[s.past.length - 1];
    if (!previous) return;
    set({
      project: previous,
      past: s.past.slice(0, -1),
      future: [s.project, ...s.future],
      lastEdit: null,
      selectedId: previous.elements.some((e) => e.id === s.selectedId) ? s.selectedId : null,
    });
  },

  redo: () => {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    set({
      project: next,
      past: [...s.past, s.project],
      future: s.future.slice(1),
      lastEdit: null,
      selectedId: next.elements.some((e) => e.id === s.selectedId) ? s.selectedId : null,
    });
  },

  loadProject: (project) => {
    set((s) => ({
      project: normalise(project),
      past: [...s.past, s.project].slice(-HISTORY_LIMIT),
      future: [],
      selectedId: null,
      lastEdit: null,
    }));
    // The replaced project stays in the undo history, so its images stay too; anything older is garbage.
    const { project: open, past, future } = get();
    void retainAssets(new Set([open, ...past, ...future].flatMap(assetIdsOf)));
  },

  setScreen: (screen, fit) => {
    const { project } = get();
    if (sameScreen(project.screen, screen)) return;
    const elements = fit === "scale" ? fitElements(project.elements, project.screen, screen) : project.elements;
    get().commit({ ...project, screen, elements });
  },
}));

/**
 * Asset ids still wanted, for the stored-image sweep: the open project, its undo and redo history and the saved project, as they are
 * now. Null when a saved project exists but does not restore: its JSON still names images, so nothing may be deleted.
 */
export function liveAssetIds(): ReadonlySet<string> | null {
  const savedNow = readSavedState();
  if (savedNow.kind === "rejected") return null;
  const { project, past, future } = useEditor.getState();
  const projects = savedNow.kind === "restored" ? [project, ...past, ...future, savedNow.project] : [project, ...past, ...future];
  return new Set(projects.flatMap(assetIdsOf));
}

export type AutosaveStatus = { ok: true } | { ok: false; message: string };

/**
 * Autosave to localStorage, debounced, and flushed when the page is hidden or closed so the last edit is not lost.
 * `onStatus` hears every write: a failure (storage full or blocked) is reported so the user can export the project instead.
 * Called once from the app root.
 */
export function startAutosave(onStatus: (status: AutosaveStatus) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;

  const flush = () => {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(useEditor.getState().project));
      onStatus({ ok: true });
    } catch (err) {
      onStatus({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  };

  const unsubscribe = useEditor.subscribe((state, prev) => {
    if (state.project === prev.project) return;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(flush, AUTOSAVE_MS);
  });
  const onHide = () => {
    if (document.visibilityState === "hidden") flush();
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", onHide);
  return () => {
    flush();
    window.removeEventListener("pagehide", flush);
    document.removeEventListener("visibilitychange", onHide);
    unsubscribe();
  };
}

export function selectedElement(state: EditorState): Element | null {
  return state.project.elements.find((e) => e.id === state.selectedId) ?? null;
}
