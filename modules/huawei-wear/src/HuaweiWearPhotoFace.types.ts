import type { WatchfaceInfo } from './HuaweiWearWatchface.types';

/** One photo the watch's photo face holds. */
export interface PhotoFacePhoto {
  /** Position in the face's list, from 1. */
  index: number;
  /** The name the watch knows the photo by, `<name>.png`. Pass it to `deletePhoto`. */
  name: string;
  /**
   * A `file://` copy kept on this phone for photos JoyoFit uploaded; null for photos that came from elsewhere, because the
   * watch offers no preview of what it holds.
   */
  uri: string | null;
}

/** The watch's photo face, its settings and its photos. */
export interface PhotoFace {
  /** The watch's photo-capable face (type bit 5 of its face list). */
  face: WatchfaceInfo;
  /** Photos must be exactly this size in pixels: the watch's screen. */
  width: number;
  height: number;
  /** How many photos the face takes. */
  maxPhotos: number;
  /** Which `.bin` flavour the watch asked for: 0 = 32-bit, 1 = 24-bit, 2 = RGB565. */
  imageOption: number;
  /** Huawei Health's "background type" (tag 0x03 of 27/08); 2 means the watch holds `.bin` files. */
  backgroundType: number;
  /** The face can pick its text colour from the photo. */
  intellectColour: boolean;
  /** Position, style and data index when the face has them; written back unchanged when photos change. */
  positionIndex: number | null;
  styleIndex: number | null;
  dataIndex: number | null;
  photos: PhotoFacePhoto[];
  /** Unix milliseconds when the face list was read. */
  updatedAt: number;
  /**
   * Set by `addPhoto` / `deletePhoto` when the photos were saved but applying the photo face again afterwards failed: the
   * watch's answer in English. Null otherwise, and always null from `getPhotoFace` / `setPhotoFaceActive`.
   */
  applyError: string | null;
}
