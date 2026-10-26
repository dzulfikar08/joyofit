/**
 * Draws the watch app's images: one turn arrow per `dir` of protocol/watch-nav.schema.json in two sizes (big for the
 * current maneuver, small for the next-turn preview) and the app icon. All shapes are our own, plain SVG rasterised
 * with @resvg/resvg-js. The SVG sources are written next to the PNGs under tools/svg/ so they can be reviewed.
 *
 *   bun install && bun run images
 */
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../entry/src/main/js/MainAbility/common/images/", import.meta.url).pathname;
const SVG_OUT = new URL("./svg/", import.meta.url).pathname;
const ICON_OUT = new URL("../entry/src/main/resources/base/media/", import.meta.url).pathname;

/** Same palette as the Pulse watch face (faces/pulse/design.ts). */
const C = { bg: "#000000", ink: "#F5F1E8", muted: "#9BA6A8", accent: "#5FD08D" } as const;

const VIEW = 180;
const STROKE = 22;

type Dir =
  | "depart" | "straight" | "slight_left" | "left" | "sharp_left" | "slight_right" | "right" | "sharp_right"
  | "uturn" | "roundabout" | "arrive";

const ANGLE: Partial<Record<Dir, number>> = {
  straight: 0, slight_right: 45, right: 90, sharp_right: 135, slight_left: -45, left: -90, sharp_left: -135,
};

const f = (n: number) => Number(n.toFixed(2));

/** Filled arrowhead whose base centre is (x, y), pointing along angle `deg` (0 = up, 90 = right). */
function head(x: number, y: number, deg: number, color: string): string {
  const r = (deg * Math.PI) / 180;
  const dx = Math.sin(r), dy = -Math.cos(r);
  const px = -dy, py = dx;
  const len = 34, half = 26;
  const tip = [x + dx * len, y + dy * len];
  const a = [x + px * half, y + py * half];
  const b = [x - px * half, y - py * half];
  return `<path d="M${f(tip[0])} ${f(tip[1])} L${f(a[0])} ${f(a[1])} L${f(b[0])} ${f(b[1])} Z" fill="${color}" stroke="${color}" stroke-width="6" stroke-linejoin="round"/>`;
}

const line = (d: string, color: string, width = STROKE) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

function shape(dir: Dir, color: string): string {
  const angle = ANGLE[dir];
  if (angle !== undefined) {
    // Stem from the bottom to the junction, then an arm in the new direction ending in a head.
    const sharp = Math.abs(angle) > 90;
    const jx = 90, jy = angle === 0 ? 40 : sharp ? 72 : 92;
    const r = (angle * Math.PI) / 180;
    const arm = sharp ? 54 : 46;
    const ex = jx + Math.sin(r) * arm, ey = jy - Math.cos(r) * arm;
    const d = angle === 0 ? `M90 166 L90 ${jy}` : `M90 166 L${jx} ${jy} L${f(ex)} ${f(ey)}`;
    return line(d, color) + head(angle === 0 ? 90 : ex, angle === 0 ? jy : ey, angle, color);
  }
  switch (dir) {
    case "depart":
      return `<circle cx="90" cy="150" r="16" fill="none" stroke="${color}" stroke-width="10"/>` +
        line("M90 128 L90 54", color) + head(90, 54, 0, color);
    case "uturn":
      // Turns over the right: Indonesia keeps left, so a U-turn crosses to the right.
      return line("M62 166 L62 76 A38 38 0 0 1 138 76 L138 108", color) + head(138, 108, 180, color);
    case "roundabout": {
      // Clockwise ring (traffic keeps left), entry from below, exit to the upper right.
      const cx = 90, cy = 102, rr = 30;
      const ex = cx + rr * Math.cos(-Math.PI / 4), ey = cy + rr * Math.sin(-Math.PI / 4);
      const ox = ex + 14, oy = ey - 14;
      return `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="${C.muted}" stroke-width="12"/>` +
        line(`M90 166 L90 ${cy + rr} A${rr} ${rr} 0 0 1 ${f(cx - rr)} ${cy} A${rr} ${rr} 0 0 1 ${f(ex)} ${f(ey)} L${f(ox)} ${f(oy)}`, color, 18) +
        head(ox, oy, 45, color);
    }
    case "arrive":
      return `<path d="M90 168 C70 136 48 112 48 82 A42 42 0 1 1 132 82 C132 112 110 136 90 168 Z" fill="${color}"/>` +
        `<circle cx="90" cy="82" r="17" fill="${C.bg}"/>`;
  }
  throw new Error(`no shape for ${dir}`);
}

function svg(inner: string, size = VIEW, view = VIEW): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${view} ${view}">${inner}</svg>`;
}

function png(markup: string, width: number): Buffer {
  return new Resvg(markup, { fitTo: { mode: "width", value: width }, shapeRendering: 2 }).render().asPng();
}

function icon(): string {
  // Round icon: dark disc, accent ring, a right-turn arrow.
  const arrow = shape("right", C.ink).replaceAll("stroke-width=\"22\"", "stroke-width=\"20\"");
  return `<circle cx="90" cy="90" r="88" fill="#10231A"/><circle cx="90" cy="90" r="84" fill="none" stroke="${C.accent}" stroke-width="6"/>` +
    `<g transform="translate(90 90) scale(0.62) translate(-124 -117)">${arrow}</g>`;
}

const DIRS: Dir[] = ["depart", "straight", "slight_left", "left", "sharp_left", "slight_right", "right", "sharp_right", "uturn", "roundabout", "arrive"];
/** Pixel sizes: `big` for the maneuver (top of the 408x480 screen), `small` for the next-turn line. */
const SIZES = { big: 150, small: 48 } as const;
/** 114x114: the icon size Huawei's lite samples ship; larger icons are a known cause of install error 40. */
const ICON_PX = 114;

mkdirSync(OUT, { recursive: true });
mkdirSync(SVG_OUT, { recursive: true });
mkdirSync(ICON_OUT, { recursive: true });
for (const dir of DIRS) {
  for (const [name, px] of Object.entries(SIZES)) {
    const markup = svg(shape(dir, name === "big" ? C.accent : C.muted), px);
    if (name === "big") writeFileSync(`${SVG_OUT}${dir}.svg`, markup);
    writeFileSync(`${OUT}${name}_${dir}.png`, png(markup, px));
  }
}
const iconSvg = svg(icon(), ICON_PX);
writeFileSync(`${SVG_OUT}icon.svg`, iconSvg);
writeFileSync(`${ICON_OUT}icon.png`, png(iconSvg, ICON_PX));
console.log(`wrote ${DIRS.length * 2} arrows to ${OUT} and the icon to ${ICON_OUT}`);
