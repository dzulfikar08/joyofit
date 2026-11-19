import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Image, PixelRatio, StyleSheet, View } from 'react-native';
import Svg, {
  ClipPath,
  Defs,
  Ellipse,
  G,
  Image as SvgImage,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import type { FontMap } from '../core/text';
import { splitColor, type ImageNode, type LinearPaint, type Paint, type RadialPaint, type Scene, type SceneNode, type Stroke } from '../core/scene';

/** Stickers are laid out on a 1080-wide design canvas; drawn at 1080 / PixelRatio dp the capture is 1080 px on any phone. */
export const DESIGN_WIDTH = 1080;
export const EXPORT_CARD_WIDTH = DESIGN_WIDTH / PixelRatio.get();

export interface PaintDefs {
  /** `<Defs>` children, in order. */
  defs: ReactNode[];
  next(): string;
}

function isLinear(paint: Paint | LinearPaint): paint is LinearPaint {
  return typeof paint === 'object' && 'linear' in paint;
}

function isRadial(paint: Paint): paint is RadialPaint {
  return typeof paint === 'object' && 'radial' in paint;
}

/** A paint as `fill` / `stroke` props plus the opacity its alpha channel carries; gradients register a def and return `url(#id)`. */
function paintProps(paint: Paint | undefined, defs: PaintDefs): { value: string; opacity: number } | null {
  if (paint === undefined) return null;
  if (typeof paint === 'string') {
    const { rgb, a } = splitColor(paint);
    return { value: rgb, opacity: a };
  }
  const id = defs.next();
  if (isLinear(paint)) {
    const { x1, y1, x2, y2, stops } = paint.linear;
    defs.defs.push(
      <LinearGradient key={id} id={id} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>
        {stops.map((stop, i) => {
          const { rgb, a } = splitColor(stop.color);
          return <Stop key={i} offset={stop.at} stopColor={rgb} stopOpacity={a} />;
        })}
      </LinearGradient>,
    );
  } else if (isRadial(paint)) {
    const { cx, cy, r, stops } = paint.radial;
    defs.defs.push(
      <RadialGradient key={id} id={id} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={r} fx={cx} fy={cy}>
        {stops.map((stop, i) => {
          const { rgb, a } = splitColor(stop.color);
          return <Stop key={i} offset={stop.at} stopColor={rgb} stopOpacity={a} />;
        })}
      </RadialGradient>,
    );
  }
  return { value: `url(#${id})`, opacity: 1 };
}

function strokeProps(stroke: Stroke | undefined, defs: PaintDefs) {
  if (!stroke || stroke.width <= 0) return {};
  const paint = paintProps(stroke.color, defs);
  if (!paint) return {};
  return {
    stroke: paint.value,
    strokeOpacity: paint.opacity,
    strokeWidth: stroke.width,
    strokeDasharray: stroke.dash ? stroke.dash : undefined,
    strokeLinecap: stroke.cap ?? 'round',
    strokeLinejoin: stroke.join ?? 'round',
  } as const;
}

function fillProps(paint: Paint | undefined, defs: PaintDefs) {
  const p = paintProps(paint, defs);
  return p ? ({ fill: p.value, fillOpacity: p.opacity } as const) : ({ fill: 'none' } as const);
}

export interface DrawEnv {
  defs: PaintDefs;
  fonts: FontMap;
  /** Image nodes drawn inside the SVG (the leading ones are RN `Image`s under it). */
  clipCounter: { n: number };
}

export function drawNode(node: SceneNode, key: string, env: DrawEnv): ReactNode {
  switch (node.k) {
    case 'rect':
      return (
        <Rect
          key={key}
          x={node.x}
          y={node.y}
          width={node.w}
          height={node.h}
          rx={node.rx}
          ry={node.rx}
          opacity={node.opacity}
          {...fillProps(node.fill, env.defs)}
          {...strokeProps(node.stroke, env.defs)}
        />
      );
    case 'ellipse':
      return (
        <Ellipse
          key={key}
          cx={node.cx}
          cy={node.cy}
          rx={node.rx}
          ry={node.ry}
          opacity={node.opacity}
          {...fillProps(node.fill, env.defs)}
          {...strokeProps(node.stroke, env.defs)}
        />
      );
    case 'path': {
      const path = (
        <Path
          key={key}
          d={node.d}
          opacity={node.opacity}
          fillRule={node.fillRule}
          {...fillProps(node.fill, env.defs)}
          {...strokeProps(node.stroke, env.defs)}
        />
      );
      if (!node.transform) return path;
      const { x, y, scale } = node.transform;
      return (
        <G key={key} transform={`translate(${x} ${y}) scale(${scale})`}>
          {path}
        </G>
      );
    }
    case 'text': {
      const { family } = env.fonts.paint(node.font, node.weight);
      return (
        <SvgText
          key={key}
          x={node.x}
          y={node.y}
          fill={splitColor(node.fill).rgb}
          fillOpacity={splitColor(node.fill).a}
          opacity={node.opacity}
          fontFamily={family}
          fontSize={node.size}
          textAnchor={node.anchor}
          letterSpacing={node.letterSpacing}>
          {node.text}
        </SvgText>
      );
    }
    case 'image': {
      const clipId = node.rx ? `clip${env.clipCounter.n++}` : null;
      return (
        <G key={key} opacity={node.opacity}>
          {clipId ? (
            <Defs>
              <ClipPath id={clipId}>
                <Rect x={node.x} y={node.y} width={node.w} height={node.h} rx={node.rx} ry={node.rx} />
              </ClipPath>
            </Defs>
          ) : null}
          <SvgImage
            x={node.x}
            y={node.y}
            width={node.w}
            height={node.h}
            href={{ uri: node.uri }}
            preserveAspectRatio={node.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
            clipPath={clipId ? `url(#${clipId})` : undefined}
          />
        </G>
      );
    }
    case 'group': {
      const clipId = node.clip ? `clip${env.clipCounter.n++}` : null;
      const children = node.children.map((child, i) => drawNode(child, `${key}.${i}`, env));
      const inner = clipId ? (
        <G key={`${key}.c`} clipPath={`url(#${clipId})`}>
          {children}
        </G>
      ) : (
        children
      );
      const rotated = node.rotate ? (
        <G key={`${key}.r`} rotation={node.rotate.deg} origin={`${node.rotate.cx}, ${node.rotate.cy}`}>
          {inner}
        </G>
      ) : (
        inner
      );
      return (
        <G key={key} opacity={node.opacity}>
          {clipId && node.clip ? (
            <Defs>
              <ClipPath id={clipId}>
                <Rect x={node.clip.x} y={node.clip.y} width={node.clip.w} height={node.clip.h} rx={node.clip.rx} ry={node.clip.rx} />
              </ClipPath>
            </Defs>
          ) : null}
          {rotated}
        </G>
      );
    }
  }
}

/** The image nodes at the bottom of the stack (a photo background) are RN `Image`s, which report `onLoad`; the rest stay in the SVG. */
function leadingImages(nodes: readonly SceneNode[]): { images: ImageNode[]; rest: SceneNode[] } {
  let i = 0;
  while (i < nodes.length && nodes[i]!.k === 'image') i++;
  return { images: nodes.slice(0, i) as ImageNode[], rest: nodes.slice(i) };
}

export interface ScenePainterProps {
  scene: Scene;
  fonts: FontMap;
  /** Rendered width in dp; the height follows the scene. Defaults to the export size (1080 px on this screen). */
  width?: number;
  /** Called once every image of `scene.needsImages` has loaded or failed; `failed` lists the URIs that did not load. */
  onImagesSettled?: (failed: readonly string[]) => void;
}

/**
 * The one native painter: a 1:1 map of the Scene onto react-native-svg, no layout of its own. Mount it at the export width
 * and capture it with view-shot for the exact PNG; mount it at a smaller width for a preview or thumbnail (the SVG viewBox
 * scales every node, so previews are pixel-for-pixel the export, just smaller).
 */
function ScenePainterImpl({ scene, fonts, width = EXPORT_CARD_WIDTH, onImagesSettled }: ScenePainterProps) {
  const height = (width * scene.height) / scene.width;
  const { images, rest } = useMemo(() => leadingImages(scene.nodes), [scene]);

  const { svgChildren, defs } = useMemo(() => {
    let counter = 0;
    const paintDefs: PaintDefs = { defs: [], next: () => `g${counter++}` };
    const env: DrawEnv = { defs: paintDefs, fonts, clipCounter: { n: 0 } };
    return { svgChildren: rest.map((node, i) => drawNode(node, `n${i}`, env)), defs: paintDefs.defs };
  }, [rest, fonts]);

  // The photo is the one image whose load a capture must wait for.
  const pending = useRef<Set<string>>(new Set());
  const failed = useRef<string[]>([]);
  const settled = useRef(false);
  useEffect(() => {
    pending.current = new Set(scene.needsImages);
    failed.current = [];
    settled.current = false;
    if (scene.needsImages.length === 0) {
      settled.current = true;
      onImagesSettled?.([]);
    }
    // `onImagesSettled` is read at call time; a new callback must not restart the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  const done = (uri: string, ok: boolean) => {
    if (settled.current || !pending.current.has(uri)) return;
    pending.current.delete(uri);
    if (!ok) failed.current.push(uri);
    if (pending.current.size === 0) {
      settled.current = true;
      onImagesSettled?.(failed.current);
    }
  };

  const k = width / scene.width;
  return (
    <View collapsable={false} style={{ width, height, overflow: 'hidden' }}>
      {images.map((node, i) => (
        <View
          key={`img${i}`}
          style={{
            position: 'absolute',
            left: node.x * k,
            top: node.y * k,
            width: node.w * k,
            height: node.h * k,
            borderRadius: (node.rx ?? 0) * k,
            overflow: 'hidden',
            opacity: node.opacity,
          }}>
          <Image
            source={{ uri: node.uri }}
            resizeMode={node.fit}
            fadeDuration={0}
            style={StyleSheet.absoluteFill}
            onLoad={() => done(node.uri, true)}
            onError={() => done(node.uri, false)}
          />
        </View>
      ))}
      <Svg width={width} height={height} viewBox={`0 0 ${scene.width} ${scene.height}`} style={StyleSheet.absoluteFill}>
        <Defs>{defs}</Defs>
        {svgChildren}
      </Svg>
    </View>
  );
}

export const ScenePainter = memo(ScenePainterImpl);
