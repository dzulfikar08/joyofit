/**
 * Export to MP4: the glue between the frame scheduler and the native encoder (`modules/replay-encoder`: Android MediaCodec +
 * MediaMuxer, iOS AVAssetWriter). Frames are captured one at a time by the caller (`renderFrame`) and streamed to the encoder,
 * so memory is two frame files at most; the encoder writes the H.264 stream as it goes.
 */
import { Directory, File, Paths } from 'expo-file-system';

import ReplayEncoder from '../../../modules/replay-encoder';
import {
  EXPORT_FPS,
  EXPORT_HEIGHT,
  EXPORT_WIDTH,
  runExport,
  type ExportProgress,
  type FrameJob,
  type FrameSink,
} from './scheduler';

/** The phone cannot encode H.264 MP4 (or the module is missing from this build). */
export class EncoderUnsupportedError extends Error {
  constructor() {
    super('video encoder unsupported');
    this.name = 'EncoderUnsupportedError';
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export interface EncodedVideo {
  /** `file://` URI of the MP4 in the cache. */
  uri: string;
  bytes: number;
  frames: number;
  durationMs: number;
}

/**
 * What view-shot is asked for per frame. High-quality JPEG (quality: 0.95) on both Android and iOS,
 * which FrameLoader (Android) and AVAssetWriter (iOS) decode efficiently with bitmap pooling,
 * avoiding raw uncompressed buffer overflows and massive flash writes.
 */
export const FRAME_FORMAT = 'jpg';

export interface EncodeOptions {
  totalSec: number;
  speed: number;
  /** Draws the frame and captures it at 1080 x 1920; returns the file URI. */
  renderFrame: (job: FrameJob, signal: AbortSignal) => Promise<string>;
  onProgress?: (progress: ExportProgress) => void;
  signal: AbortSignal;
}

function cacheDir(): Directory {
  const dir = new Directory(Paths.cache, 'replay');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Old exports go: the cache must not keep a video per attempt. Also what a deleted workout's replay leaves behind. */
export function clearReplayVideos(): void {
  for (const entry of cacheDir().list()) {
    if (entry instanceof File && entry.name.endsWith('.mp4')) {
      try {
        entry.delete();
      } catch {
        // A video the share sheet still holds open is left for the next time.
      }
    }
  }
}

export async function encodeReplay(opts: EncodeOptions): Promise<EncodedVideo> {
  const support = await ReplayEncoder.getSupport().catch(() => null);
  if (!support || !support.available || !support.h264) throw new EncoderUnsupportedError();
  clearReplayVideos();
  const file = new File(cacheDir(), `replay-${Date.now()}.mp4`);
  const session = await ReplayEncoder.begin({ path: file.uri, width: EXPORT_WIDTH, height: EXPORT_HEIGHT, fps: EXPORT_FPS }).catch((e: unknown) => {
    // No encoder takes 1080 x 1920 H.264 on this phone: say so, rather than a code.
    throw hasCode(e, 'ERR_ENCODER_UNSUPPORTED') ? new EncoderUnsupportedError() : e;
  });
  const sink: FrameSink = {
    appendFrame: (index, uri) => ReplayEncoder.appendFrame(session.id, uri, index),
    finish: () => ReplayEncoder.finish(session.id),
    cancel: () => ReplayEncoder.cancel(session.id),
  };
  return runExport({
    totalSec: opts.totalSec,
    speed: opts.speed,
    fps: EXPORT_FPS,
    renderFrame: opts.renderFrame,
    sink,
    discard: (uri) => {
      try {
        new File(uri).delete();
      } catch {
        // The cache is cleaned by the system; a frame file that is already gone is fine.
      }
    },
    onProgress: opts.onProgress,
    signal: opts.signal,
  });
}

/** Deletes a finished video (after the person closes the sheet). */
export function deleteVideo(uri: string): void {
  try {
    new File(uri).delete();
  } catch {
    // Already gone.
  }
}
