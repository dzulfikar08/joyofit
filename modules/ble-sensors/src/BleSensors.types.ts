export type BluetoothState = 'on' | 'off' | 'unauthorized' | 'unsupported' | 'unknown';

/** 16-bit assigned numbers as 4 lowercase hex digits; the native side maps them to the 128-bit Bluetooth base UUID. */
export const SERVICE = {
  heartRate: '180d',
  cyclingSpeedCadence: '1816',
  cyclingPower: '1818',
  runningSpeedCadence: '1814',
  battery: '180f',
  deviceInformation: '180a',
} as const;

/** The characteristics the native side subscribes to (notify/indicate) or reads once per (re)connect. */
export const CHARACTERISTIC = {
  heartRateMeasurement: '2a37',
  cscMeasurement: '2a5b',
  cyclingPowerMeasurement: '2a63',
  rscMeasurement: '2a53',
  batteryLevel: '2a19',
  manufacturerName: '2a29',
  modelNumber: '2a24',
} as const;

/**
 * Per service: which characteristics the native side handles and how. `notify` = enable notifications (indications when the sensor
 * offers only those), `read` = read once after (re)connecting. Battery level is read once AND subscribed when the sensor can notify.
 * The same table is implemented in Kotlin (SensorProfile.kt) and Swift (SensorProfile.swift); keep the three in step.
 */
export const SENSOR_CHARACTERISTICS = [
  { service: SERVICE.heartRate, characteristic: CHARACTERISTIC.heartRateMeasurement, mode: 'notify' },
  { service: SERVICE.cyclingSpeedCadence, characteristic: CHARACTERISTIC.cscMeasurement, mode: 'notify' },
  { service: SERVICE.cyclingPower, characteristic: CHARACTERISTIC.cyclingPowerMeasurement, mode: 'notify' },
  { service: SERVICE.runningSpeedCadence, characteristic: CHARACTERISTIC.rscMeasurement, mode: 'notify' },
  { service: SERVICE.battery, characteristic: CHARACTERISTIC.batteryLevel, mode: 'read+notify' },
  { service: SERVICE.deviceInformation, characteristic: CHARACTERISTIC.manufacturerName, mode: 'read' },
  { service: SERVICE.deviceInformation, characteristic: CHARACTERISTIC.modelNumber, mode: 'read' },
] as const;

export interface ScanResultEvent {
  /** Android: MAC address. iOS: CBPeripheral identifier (a UUID, stable on this phone only). */
  id: string;
  /** The advertised or cached name; null when the sensor does not advertise one. */
  name: string | null;
  rssi: number;
  /** The supported services the advertisement lists, as 4-digit hex (`SERVICE`). Sensors that leave the list out are not found by the filter. */
  services: string[];
}

export interface ScanStateEvent {
  scanning: boolean;
  /** An error code (ERR_BLUETOOTH_PERMISSION, ERR_BLUETOOTH_OFF, ...) when the scan ended because of it. */
  error: string | null;
}

export type SensorLinkState = 'connecting' | 'connected' | 'disconnected';

export interface ConnectionEvent {
  id: string;
  state: SensorLinkState;
  /** Set when `state` is `connected`: the supported services the GATT discovery found (4-digit hex). */
  services: string[];
  /** The last failure, human readable English for the log (not shown to users); null while fine. */
  error: string | null;
}

/** One notification or read result. `value` is the raw characteristic value as lowercase hex without separators. */
export interface ValueEvent {
  id: string;
  /** Milliseconds since the epoch, taken on the radio thread when the value arrived (not when JS got it). */
  ts: number;
  service: string;
  characteristic: string;
  value: string;
}

export interface LocationEvent {
  /** Milliseconds since the epoch of the fix itself (Location.getTime / CLLocation.timestamp). */
  ts: number;
  lat: number;
  lon: number;
  /** Metres above sea level, null when the fix has none. */
  alt: number | null;
  /** Horizontal accuracy in metres (68 % radius), null when unknown. */
  accuracy: number | null;
  /** Ground speed in m/s, null when the platform has none. */
  speed: number | null;
  bearing: number | null;
}

export type LocationPermission = 'granted' | 'denied' | 'undetermined';

export interface WorkoutSessionOptions {
  /** Notification title (Android), e.g. "Lari". */
  title: string;
  /** Notification text (Android) before the first `updateWorkoutSession`. */
  text: string;
  /** Record GPS: starts location updates and, on Android, the location foreground type. */
  gps: boolean;
  /**
   * Android: the link (`joyofit://...`) tapping the notification opens, so it lands on the recording screen whatever screen was open last.
   * Without it, or when it is not a link of the app, the tap resumes the app where it was. iOS has no notification: ignored.
   */
  openUrl?: string;
  /**
   * Android: Pause/Resume and Lap buttons on the notification, with their texts in the app's language. A press arrives as `onWorkoutAction`.
   * Without it the notification has no buttons. iOS ignores it.
   */
  controls?: WorkoutControls;
}

export interface WorkoutControls {
  /** BCP 47 tag the notification formats the distance with (decimal separator), e.g. `id`. */
  locale: string;
  /** Shown in front of the frozen time while paused. */
  paused: string;
  pause: string;
  resume: string;
  lap: string;
}

/**
 * What `updateWorkoutSession` reports (Android): the recorder's own numbers. The notification counts the time itself (a chronometer, no
 * update needed) and adds GPS distance from its own fixes between two reports, so a throttled JS thread leaves it counting.
 */
export interface WorkoutSessionState {
  /** The recorder's clock in seconds (stops while paused). */
  movingSec: number;
  distanceM: number;
  hr: number | null;
  paused: boolean;
}

export type WorkoutAction = 'pause' | 'resume' | 'lap';

/**
 * Bathroom scales. The native side only moves bytes; `src/features/scale` decodes them. Identifiers are normalised the same way on both
 * platforms and in `src/features/scale/uuid.ts`: 4 lowercase hex digits for Bluetooth-base UUIDs, else the full lowercase 36-char form.
 */
export interface ScaleAdvertisementEvent {
  /** Android: MAC address. iOS: CBPeripheral identifier (a UUID, stable on this phone only). */
  id: string;
  name: string | null;
  rssi: number;
  /** Milliseconds since the epoch, taken on the radio thread. */
  ts: number;
  serviceUuids: string[];
  /** Service UUID to payload hex. */
  serviceData: Record<string, string>;
  /** Company identifier (4 lowercase hex digits of the 16-bit value) to the payload hex after it. */
  manufacturerData: Record<string, string>;
}

export type ScaleCharacteristicProperty = 'read' | 'write' | 'writeNoResponse' | 'notify' | 'indicate';

export interface ScaleServiceInfo {
  uuid: string;
  characteristics: { uuid: string; properties: ScaleCharacteristicProperty[] }[];
}

export interface ScaleLinkEvent {
  id: string;
  state: SensorLinkState;
  /** Set when `state` is `connected`: every service GATT discovery found, with its characteristics. */
  services: ScaleServiceInfo[];
  /** English, for the log; null when the link was closed on request. */
  error: string | null;
}

export type BleSensorsModuleEvents = {
  onScanResult: (event: ScanResultEvent) => void;
  onScanState: (event: ScanStateEvent) => void;
  onConnection: (event: ConnectionEvent) => void;
  onValue: (event: ValueEvent) => void;
  onLocation: (event: LocationEvent) => void;
  onBluetoothState: (event: { state: BluetoothState }) => void;
  /** Android: a button of the recording notification was pressed (only with `WorkoutSessionOptions.controls`). */
  onWorkoutAction: (event: { action: WorkoutAction }) => void;
  onScaleAdvertisement: (event: ScaleAdvertisementEvent) => void;
  onScaleScanState: (event: ScanStateEvent) => void;
  onScaleLink: (event: ScaleLinkEvent) => void;
  onScaleValue: (event: ValueEvent) => void;
};
