import { NativeModule, requireNativeModule } from 'expo';
import type {
  BleSensorsModuleEvents,
  BluetoothState,
  ConnectionEvent,
  LocationPermission,
  RoomAdvert,
  RoomCaptureOptions,
  RoomCaptureState,
  StepCounterPermission,
  WorkoutSessionOptions,
  WorkoutSessionState,
} from './BleSensors.types';

declare class BleSensorsModule extends NativeModule<BleSensorsModuleEvents> {
  /**
   * The radio state. On iOS the first call creates the CBCentralManager, which is what raises the system Bluetooth prompt, so call it
   * from a screen that explains why first. Android never prompts here (the app asks for BLUETOOTH_SCAN / BLUETOOTH_CONNECT through
   * PermissionsAndroid first, see features/sensors/permissions.ts).
   */
  bluetoothState(): Promise<BluetoothState>;

  /**
   * Scans for sensors that advertise the Heart Rate (180D), Cycling Speed and Cadence (1816), Cycling Power (1818) or Running Speed
   * and Cadence (1814) service, filtered by those UUIDs in the radio so it keeps working with the screen off. Every advertisement
   * arrives as `onScanResult` (repeats included; the JS side de-duplicates by id). Stops by itself after 20 s (`onScanState`).
   * Rejects with ERR_BLUETOOTH_PERMISSION, ERR_BLUETOOTH_OFF or ERR_BLUETOOTH_UNAVAILABLE.
   */
  startScan(): Promise<void>;
  stopScan(): Promise<void>;

  /**
   * Starts connecting to a sensor and KEEPS it connected: when the link drops (out of range, strap taken off, sensor asleep) the
   * module reconnects by itself with a growing delay until `disconnect` or `disconnectAll`. Resolves as soon as the request is accepted;
   * progress arrives as `onConnection`. A connected sensor streams every characteristic of the supported table (see
   * BleSensors.types.ts `SENSOR_CHARACTERISTICS`) as `onValue`, and the module reads the battery level and the device information once
   * after each (re)connect. `id` is what `onScanResult` reported (Android: the MAC address; iOS: the CBPeripheral identifier UUID).
   * Rejects with ERR_BLUETOOTH_PERMISSION, ERR_BLUETOOTH_OFF, ERR_BLUETOOTH_UNAVAILABLE or ERR_INVALID_ARGUMENT (unknown id).
   */
  connect(id: string): Promise<void>;
  /** Drops the link and stops reconnecting. Resolves even when the sensor was not connected. */
  disconnect(id: string): Promise<void>;
  disconnectAll(): Promise<void>;
  /** The current state of every sensor `connect` was called for, so a screen that mounts later can show it. */
  connectionStates(): Promise<ConnectionEvent[]>;

  /** `granted` means precise location while in use. Android: ACCESS_FINE_LOCATION. iOS: authorizedWhenInUse or authorizedAlways. */
  locationPermission(): Promise<LocationPermission>;
  /**
   * iOS only: raises the system "while using the app" prompt and resolves with the answer. Android asks through PermissionsAndroid
   * (features/sensors/permissions.ts), so this function does not exist there.
   */
  requestLocationPermission(): Promise<LocationPermission>;

  /**
   * The phone's step counter, used by a workout session started with `steps`. `unavailable` without the sensor. Android: `granted` or
   * `denied` (ACTIVITY_RECOGNITION, asked through PermissionsAndroid; always granted before Android 10). iOS: CMPedometer authorization.
   */
  stepCounterPermission(): Promise<StepCounterPermission>;
  /**
   * iOS only: starts a tiny pedometer query so the system raises its motion prompt, and resolves with the answer. Android asks through
   * PermissionsAndroid (features/sensors/permissions.ts), so this function does not exist there.
   */
  requestStepCounterPermission(): Promise<StepCounterPermission>;
  /**
   * Store build only: absent on a binary built before it, so check `typeof module.startLiveSteps === 'function'` first
   * (`src/features/live/liveExtras.ts` does).
   *
   * The phone's step counter for the live screen of a workout started on the watch, without a workout session (no foreground service,
   * no GPS): readings arrive as `onLiveSteps`, counted from this call (cumulative). A counter of its own, apart from the one of
   * `startWorkoutSession({ steps })`. Resolves false without the sensor or the permission (Android: ACTIVITY_RECOGNITION; iOS: motion,
   * where an undetermined permission raises the prompt). Calling it while it runs does nothing.
   */
  startLiveSteps(): Promise<boolean>;
  /** Stops the live screen's step counter. Resolves even when it did not run. */
  stopLiveSteps(): Promise<void>;

  /**
   * Bathroom scales. Starts an UNFILTERED scan (a scale that broadcasts its weight hides it in manufacturer data, so there is no service
   * to filter by) and reports each advertisement as `onScaleAdvertisement`; an identical repeat arrives at most every 2 s, a changed payload
   * at once. `ids` limits it to scales already picked (empty = everything around). `lowLatency` false asks for the battery friendly radio duty cycle (Android; iOS has one mode). Ends by itself after `durationMs` (5 s .. 180 s) or at
   * `stopScaleScan`; `onScaleScanState` tells. Foreground only on iOS. Rejects with ERR_BLUETOOTH_PERMISSION, ERR_BLUETOOTH_OFF or
   * ERR_BLUETOOTH_UNAVAILABLE. Independent from `startScan` (sports sensors).
   */
  startScaleScan(ids: string[], durationMs: number, lowLatency: boolean): Promise<void>;
  stopScaleScan(): Promise<void>;
  /**
   * Connects to a scale and discovers every service. No reconnect: `onScaleLink` reports connecting, connected (with the services) and
   * disconnected (with the reason), and JS decides what to do. Replaces an earlier link to the same scale.
   */
  scaleConnect(id: string): Promise<void>;
  scaleDisconnect(id: string): Promise<void>;
  /**
   * GATT operations on a connected scale, run one at a time in call order. Each resolves when the operation finished (descriptor written,
   * write acknowledged, read answered) and rejects with ERR_SCALE_NOT_CONNECTED, ERR_SCALE_NO_CHARACTERISTIC, ERR_SCALE_OPERATION_REFUSED
   * or ERR_SCALE_GATT_<status>. Values of notifications, indications and reads arrive as `onScaleValue` (hex). Services and characteristics
   * are in the normalised form of src/features/scale/uuid.ts; `hex` is bytes without separators. A write without response resolves once
   * the stack took it.
   */
  scaleSubscribe(id: string, service: string, characteristic: string): Promise<void>;
  scaleRead(id: string, service: string, characteristic: string): Promise<void>;
  scaleWrite(id: string, service: string, characteristic: string, hex: string, withResponse: boolean): Promise<void>;

  /**
   * ANDROID ONLY, store build only: absent on iOS and on a binary built before it existed, so check `typeof module.startRoomCapture ===
   * 'function'` first (`src/features/thermometer/native.ts` does).
   *
   * Starts the overnight scan of the bedroom thermometer: a foreground service (type connectedDevice) with an ongoing notification and a
   * low-power scan filtered by `ids` in the Bluetooth controller, so it keeps running with the screen off and the app closed. It keeps one
   * advertisement per sensor per 5 minutes in a file and ends at `untilMs`, on the notification's Stop button, or at `stopRoomCapture`.
   * Calling it while a capture runs replaces the request. Call it while the app is visible. Rejects with ERR_BLUETOOTH_PERMISSION,
   * ERR_BLUETOOTH_OFF, ERR_BLUETOOTH_UNAVAILABLE, ERR_INVALID_ARGUMENT (no address, end time not ahead) or ERR_SERVICE_NOT_ALLOWED.
   */
  startRoomCapture(options: RoomCaptureOptions): Promise<void>;
  /** Stops the overnight scan. What it already kept stays for `roomAdverts`. Resolves even when none ran. */
  stopRoomCapture(): Promise<void>;
  roomCaptureState(): Promise<RoomCaptureState>;
  /**
   * ANDROID ONLY, store build only, and absent on a build older than the stock-firmware thermometer support: the service data UUIDs the
   * overnight scan keeps (`181a`, `fcd2` and, from that build on, `fe95`, the MiBeacon frames of a stock Xiaomi unit). JS opens them with
   * the bind key; an older build ignores such a unit while the app is closed, so check `includes('fe95')` before relying on it.
   */
  roomCaptureServices(): string[];
  /** What the overnight scan kept and JS has not removed yet, oldest first. Reading does not remove. */
  roomAdverts(): Promise<RoomAdvert[]>;
  /** Removes the advertisements heard at `upToTs` (epoch ms) or earlier: call it after they were stored. */
  clearRoomAdverts(upToTs: number): Promise<void>;

  /**
   * Starts the phone side of a recorded workout so it survives a locked screen:
   * - Android: a foreground service (type location when `gps`, plus connectedDevice) with an ongoing notification and a partial wake lock.
   * - iOS: background location updates when `gps` (blue status-bar pill), nothing else; Bluetooth keeps running through the
   *   `bluetooth-central` background mode.
   * With `gps` it also starts GPS fixes, delivered as `onLocation` about once a second. With `steps` it also starts the phone's step counter, delivered as `onSteps`. Calling it while a session runs only updates
   * the options. Rejects with ERR_LOCATION_PERMISSION (`gps` without precise location), ERR_SERVICE_NOT_ALLOWED (Android refused
   * the foreground service: GPS fixes and the wake lock run anyway and the promise rejects only after they started, so the caller
   * continues and warns that the recording may stop with the screen locked).
   */
  startWorkoutSession(options: WorkoutSessionOptions): Promise<void>;
  /** Android: reports the recorder's numbers to the notification (it counts the time itself between reports). iOS: no-op. */
  updateWorkoutSession(state: WorkoutSessionState): Promise<void>;
  /** Stops GPS, the foreground service and the wake lock. Sensor links stay up (disconnect them yourself). */
  endWorkoutSession(): Promise<void>;
  isWorkoutSessionActive(): boolean;
}

export default requireNativeModule<BleSensorsModule>('BleSensors');
