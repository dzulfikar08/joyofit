import {
  formatCompact,
  formatDate,
  formatDuration,
  formatDurationHM,
  formatKm,
  formatNumber,
  formatPace,
  formatPercent,
  formatSigned,
  formatTime,
  type DateStyle,
  type Locale,
} from "./format";
import { sanitizeText } from "./text";
import type { Issue } from "./scene";

/**
 * Bindings. A string Expr is literal text with `{path|filter:arg}` placeholders;
 * `{t, args}` calls the host's translator. Any unresolved non-optional placeholder
 * makes the whole expression missing (the layer then hides or substitutes).
 */

export type Expr = string | { t: string; args?: Record<string, string> };

export type NumRef =
  | number
  | { bind: string; div?: string | number; mul?: number; add?: number; clamp?: [number, number] };

export type Translate = (key: string, args: Record<string, string | number>) => string;

export type Env = {
  locale: Locale;
  get(path: string): unknown;
  t: Translate;
  issues: Issue[];
};

type Placeholder = { path: string; optional: boolean; filters: { name: string; args: string[] }[] };
type Part = string | Placeholder;

const cache = new Map<string, Part[]>();

export function isMissing(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (typeof value === "number" && Number.isNaN(value))
  );
}

/** Splits a template string into literal and placeholder parts. Malformed `{` is literal. */
export function parseTemplateString(source: string): Part[] {
  const hit = cache.get(source);
  if (hit) return hit;
  const parts: Part[] = [];
  let literal = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "{" && source[i + 1] === "{") {
      literal += "{";
      i += 2;
    } else if (ch === "}" && source[i + 1] === "}") {
      literal += "}";
      i += 2;
    } else if (ch === "{") {
      const close = source.indexOf("}", i);
      const inner = close === -1 ? null : source.slice(i + 1, close);
      const ph = inner === null ? null : parsePlaceholder(inner);
      if (ph) {
        if (literal) parts.push(literal);
        literal = "";
        parts.push(ph);
        i = close + 1;
      } else {
        literal += ch;
        i++;
      }
    } else {
      literal += ch;
      i++;
    }
  }
  if (literal) parts.push(literal);
  if (cache.size > 500) cache.clear();
  cache.set(source, parts);
  return parts;
}

const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/;

function parsePlaceholder(inner: string): Placeholder | null {
  const segments = inner.split("|").map((s) => s.trim());
  let path = segments[0] ?? "";
  let optional = false;
  if (path.endsWith("?")) {
    optional = true;
    path = path.slice(0, -1);
  }
  if (!PATH.test(path)) return null;
  const filters = segments.slice(1).map((seg) => {
    const colon = seg.indexOf(":");
    if (colon === -1) return { name: seg, args: [] };
    return { name: seg.slice(0, colon), args: seg.slice(colon + 1).split(",") };
  });
  return { path, optional, filters };
}

/** Every path a template string reads (for `requires` linting and Studio rebinding). */
export function exprPaths(expr: Expr): string[] {
  if (typeof expr !== "string") {
    return Object.values(expr.args ?? {}).flatMap((arg) => exprPaths(arg));
  }
  return parseTemplateString(expr).flatMap((p) => (typeof p === "string" ? [] : [p.path]));
}

const FILTERS = new Set([
  "int",
  "num",
  "signed",
  "pct",
  "compact",
  "unit",
  "dur",
  "durhm",
  "pace",
  "km",
  "m",
  "date",
  "time",
  "upper",
  "lower",
  "title",
  "ellipsis",
  "first",
  "plural",
  "default",
]);

export function isKnownFilter(name: string): boolean {
  return FILTERS.has(name);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function digitsArg(args: string[], fallback: number): number {
  const n = Number(args[0]);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : fallback;
}

/** One filter step; `undefined` means missing/invalid. */
function applyFilter(value: unknown, name: string, args: string[], locale: Locale): unknown {
  if (name === "default") return isMissing(value) ? (args.join(",") || "-") : value;
  if (isMissing(value)) return undefined;
  const n = asNumber(value);
  const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
  switch (name) {
    case "int":
      return n === null ? undefined : formatNumber(n, locale, 0);
    case "num":
      return n === null ? undefined : formatNumber(n, locale, digitsArg(args, 1));
    case "signed":
      return n === null ? undefined : formatSigned(n, locale, digitsArg(args, 0));
    case "pct":
      return n === null ? undefined : formatPercent(n, locale, digitsArg(args, 0));
    case "compact":
      return n === null ? undefined : formatCompact(n, locale);
    case "unit":
      return text === null || !args[0] ? undefined : `${text} ${args.join(",")}`;
    case "dur":
      return n === null ? undefined : formatDuration(n);
    case "durhm":
      return n === null ? undefined : formatDurationHM(n, locale);
    case "pace":
      return n === null ? undefined : formatPace(n);
    case "km":
      return n === null ? undefined : formatKm(n, locale, digitsArg(args, 2));
    case "m":
      return n === null ? undefined : formatNumber(n, locale, 0);
    case "date": {
      const style = (args[0] ?? "short") as DateStyle;
      return formatDate(value, style, locale) || undefined;
    }
    case "time":
      return formatTime(value, locale) || undefined;
    case "upper":
      return text?.toUpperCase();
    case "lower":
      return text?.toLowerCase();
    case "title":
      return text?.toLowerCase().replace(/(^|\s)(\S)/g, (_, sp: string, c: string) => sp + c.toUpperCase());
    case "ellipsis": {
      const max = Number(args[0]);
      if (text === null || !Number.isInteger(max) || max < 1) return undefined;
      const cps = Array.from(text);
      return cps.length > max ? `${cps.slice(0, max - 1).join("").trimEnd()}\u2026` : text;
    }
    case "first":
      return text?.trim().split(/\s+/u)[0];
    case "plural": {
      if (n === null) return undefined;
      return n === 1 ? args[0] : (args[1] ?? args[0]);
    }
    default:
      return undefined;
  }
}

function placeholderText(ph: Placeholder, env: Env): string | undefined {
  let value: unknown = env.get(ph.path);
  for (const f of ph.filters) {
    if (!FILTERS.has(f.name)) {
      env.issues.push({ code: "unknown-filter", message: `unknown filter "${f.name}"` });
      return undefined;
    }
    value = applyFilter(value, f.name, f.args, env.locale);
  }
  if (isMissing(value)) return ph.optional ? "" : undefined;
  if (typeof value === "number") return formatNumber(value, env.locale, Number.isInteger(value) ? 0 : 1);
  if (typeof value === "string") return sanitizeText(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return undefined;
}

function resolveTemplateString(source: string, env: Env): string | undefined {
  let out = "";
  for (const part of parseTemplateString(source)) {
    if (typeof part === "string") {
      out += part;
      continue;
    }
    const text = placeholderText(part, env);
    if (text === undefined) return undefined;
    out += text;
  }
  return out;
}

/** Text of `expr`, or `undefined` when any non-optional binding is missing. */
export function resolveExpr(expr: Expr, env: Env): string | undefined {
  if (typeof expr === "string") {
    const text = resolveTemplateString(expr, env);
    return text === undefined || text === "" ? undefined : text;
  }
  const args: Record<string, string | number> = {};
  for (const [name, source] of Object.entries(expr.args ?? {})) {
    const text = resolveTemplateString(source, env);
    if (text === undefined) return undefined;
    args[name] = name === "count" ? numberFromTemplate(source, env, text) : text;
  }
  const out = env.t(expr.t, args);
  return out === "" || out === expr.t ? undefined : out;
}

/** `count` must stay numeric for plural selection, so re-read the raw value when it is a bare path. */
function numberFromTemplate(source: string, env: Env, fallback: string): string | number {
  const parts = parseTemplateString(source);
  const only = parts[0];
  if (parts.length === 1 && only !== undefined && typeof only !== "string") {
    const raw = env.get(only.path);
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  const n = Number(fallback);
  return Number.isFinite(n) ? n : fallback;
}

/** Numeric value of a NumRef; `undefined` when missing or division by zero. */
export function resolveNum(ref: NumRef | undefined, env: Pick<Env, "get">): number | undefined {
  if (ref === undefined) return undefined;
  if (typeof ref === "number") return Number.isFinite(ref) ? ref : undefined;
  const base = asNumber(env.get(ref.bind));
  if (base === null) return undefined;
  let value = base;
  if (ref.div !== undefined) {
    const d = typeof ref.div === "number" ? ref.div : asNumber(env.get(ref.div));
    if (d === null || d === 0) return undefined;
    value /= d;
  }
  if (ref.mul !== undefined) value *= ref.mul;
  if (ref.add !== undefined) value += ref.add;
  if (ref.clamp) value = Math.min(ref.clamp[1], Math.max(ref.clamp[0], value));
  return Number.isFinite(value) ? value : undefined;
}

export function resolveNumberList(path: string, env: Pick<Env, "get">): (number | null)[] | undefined {
  const raw = env.get(path);
  if (!Array.isArray(raw)) return undefined;
  return raw.map((v) => {
    const n = asNumber(v);
    return n === null ? null : n;
  });
}

export function resolveStringList(path: string, env: Pick<Env, "get">): string[] | undefined {
  const raw = env.get(path);
  if (!Array.isArray(raw)) return undefined;
  return raw.map((v) => (typeof v === "string" ? sanitizeText(v, 24) : typeof v === "number" ? String(v) : ""));
}

export type Condition =
  | {
      bind: string;
      exists?: boolean;
      eq?: unknown;
      ne?: unknown;
      gt?: number;
      gte?: number;
      lt?: number;
      lte?: number;
      in?: unknown[];
    }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export function evalCondition(cond: Condition, env: Pick<Env, "get">): boolean {
  if ("all" in cond) return cond.all.every((c) => evalCondition(c, env));
  if ("any" in cond) return cond.any.some((c) => evalCondition(c, env));
  if ("not" in cond) return !evalCondition(cond.not, env);
  const v = env.get(cond.bind);
  const present = !isMissing(v);
  if (cond.exists !== undefined && cond.exists !== present) return false;
  if (cond.eq !== undefined && v !== cond.eq) return false;
  if (cond.ne !== undefined && v === cond.ne) return false;
  const n = asNumber(v);
  if (cond.gt !== undefined && !(n !== null && n > cond.gt)) return false;
  if (cond.gte !== undefined && !(n !== null && n >= cond.gte)) return false;
  if (cond.lt !== undefined && !(n !== null && n < cond.lt)) return false;
  if (cond.lte !== undefined && !(n !== null && n <= cond.lte)) return false;
  if (cond.in !== undefined && !cond.in.includes(v)) return false;
  return true;
}

/** Path lookup over nested objects and arrays; prototype keys are never traversed. */
export function lookupPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    if (Array.isArray(cur) ? !/^\d+$/.test(key) : !Object.hasOwn(cur, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}
