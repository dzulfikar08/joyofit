export { HwtError, bytesEqual, crc32, hex } from "./bytes";
export { isZip, readZip, writeZip, type ZipArchive, type ZipEntry, type ZipFraming } from "./zip";

export {
  FIT4_SCREEN,
  RESOLUTIONS,
  parseDescription,
  patchDescription,
  renderDescription,
  type HwtDescription,
  type Resolution,
} from "./description";

export {
  DEFAULT_MAX_RUN,
  DEFAULT_MIN_RUN,
  IMAGE_HEADER_SIZE,
  IMAGE_MAGIC_ARGB8888,
  RLE_ESCAPE,
  decodeImage,
  encodeImage,
  readImageHeader,
  type EncodeOptions,
  type ImageHeader,
  type RgbaImage,
} from "./image";
export { decodePng, encodePng } from "./png";

export {
  SIGNATURE_SIZE,
  TABLE_ENTRY_SIZE,
  WATCHFACE_HEADER_SIZE,
  assertEditable,
  imageIndex,
  imageRef,
  parseWatchface,
  writeWatchface,
  type IrregularBody,
  type WatchfaceBinary,
} from "./watchface";

export {
  decodePb,
  encodePb,
  encodeVarint,
  fromInt32,
  inferMessage,
  toInt32,
  type PbBytes,
  type PbField,
  type PbFieldSchema,
  type PbFixed32,
  type PbFixed64,
  type PbKind,
  type PbMessage,
  type PbMessageSchema,
  type PbSchema,
  type PbVarint,
} from "./protobuf";
export { SCHEMA_V1, ELEMENT_V1_GLYPHS, ELEMENT_V1_HAND, ELEMENT_V1_STATIC, ELEMENT_V1_TEXT } from "./schema-v1";
export { SCHEMA_V2 } from "./schema-v2";
export { buildMessage } from "./compose";
export {
  collectImageRefs,
  decodeLayout,
  describeLayout,
  encodeLayout,
  getLayout,
  layoutKindOf,
  namedMessage,
  readV1Elements,
  remapImageRefs,
  schemaFor,
  setLayout,
  usedImageIndices,
  type ImageRefField,
  type Layout,
  type LayoutKind,
  type NamedObject,
  type NamedValue,
  type V1Element,
  type V1Glyphs,
  type V1Hand,
  type V1StaticImage,
  type V1Text,
  type V1Unknown,
} from "./layout";

export {
  DESCRIPTION_ENTRY,
  HONOR_WATCHFACE_ENTRY,
  HUAWEI_WATCHFACE_ENTRY,
  NESTED_BINARY_ENTRY,
  createHwt,
  getEntry,
  previewSizes,
  readHwt,
  setEntry,
  writeHwt,
  type CreateHwtOptions,
  type PreviewSize,
  type PreviewSizes,
  type HwtPackage,
} from "./hwt";

export {
  addImage,
  addStaticImage,
  replaceImage,
  verifyWatchface,
  type ImageSource,
  type ReplaceResult,
  type StaticImageOptions,
  type WatchfaceReport,
} from "./builder";
export {
  ElementBuilder,
  FaceBuilder,
  type Align,
  type Ambient,
  type ArcOptions,
  type ContainerOptions,
  type DigitsOptions,
  type ElementLabel,
  type ElementOptions,
  type HandOptions,
  type ImageInput,
  type Point,
  type Rect,
  type SelectedOptions,
  type SingleImageOptions,
} from "./face";
export {
  CATEGORY_DRAW_TYPES,
  VALUE_TYPE,
  VALUE_TYPES,
  WIDGET_DATA_TYPE,
  valueTypeInfo,
  type DataCategory,
  type Evidence,
  type ValueTypeInfo,
} from "./valuetypes";
export { FIT4_LIMITS, checkFit4Limits, estimateLayerBytes, type LimitReport } from "./limits";
