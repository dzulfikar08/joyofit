package com.joyodigitama.huaweiwear

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteException
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import java.util.concurrent.ConcurrentHashMap
import android.os.Build
import java.io.IOException
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCoordinator.HuaweiDeviceType

/** What the notification and profile senders need from the live connection. */
internal class LinkHandle(
  val address: String,
  val session: HuaweiSession,
  val notificationState: HuaweiNotificationState,
  /** Held by syncs, battery reads and watch face operations, which must not interleave on the one session. */
  val operationLock: Mutex,
)

/**
 * The single active session to a watch: RFCOMM or BLE GATT transport (per model) + packet session + auth/init/sync, and
 * the [LinkState] machine JS observes. At most one [Connection] exists; every failure while
 * connecting (including every authentication failure) tears it down. The JS module and the
 * background service both drive this one instance.
 */
internal class WearLink(
  context: Context,
  private val events: WearEvents,
  private val settings: WearSettings,
  private val syncStore: SyncStore,
) {
  private val appContext = context.applicationContext
  private val store = DeviceStore(appContext)

  /**
   * Extra steps of an activity sync that other features add (the P2P health dictionary sync): run under the operation lock after the
   * workouts, each one logged and isolated, so a failing one never fails the sync whose rows are already committed.
   */
  internal val syncExtensions = java.util.concurrent.CopyOnWriteArrayList<suspend (HuaweiSession) -> Unit>()



  companion object {
    private const val HUAWEI_MANUFACTURER_ID = 0x027D
    private const val HONOR_MANUFACTURER_ID = 0x0079
    private const val SERVICE_FE86 = "fe86"
    private const val SERVICE_3802 = "3802"
    private const val SCAN_TIMEOUT_MS = 12_000L
  }

  private val lock = Any()
  private val discoveredDevices = ConcurrentHashMap<String, DiscoveredDevice>()
  private val discoveredNames = ConcurrentHashMap<String, String>()
  private var scanCallback: ScanCallback? = null
  private val scanHandler = android.os.Handler(android.os.Looper.getMainLooper())
  private val scanTimeoutRunnable = Runnable { stopScan() }
  @Volatile var isScanning: Boolean = false
    private set
  private var current: Connection? = null

  @Volatile
  private var state = LinkState.DISCONNECTED

  private inner class Connection(val address: String, val device: BluetoothDevice, adapter: BluetoothAdapter, val model: ModelMatch) {
    val closed = AtomicBoolean(false)
    val operationLock = Mutex()

    /** Why this connection ended, when something other than the failing operation ended it. */
    @Volatile
    var closeCause: WearException? = null

    @Volatile
    var info: Map<String, Any?>? = null

    @Volatile
    var handle: LinkHandle? = null

    /** Completes when this connect attempt finishes, so a second caller for the same watch can join it. */
    val ready = CompletableDeferred<Map<String, Any?>>()
    lateinit var session: HuaweiSession

    /** A listed model uses its Gadgetbridge coordinator's link; for other names Android's view of the device decides. */
    @Volatile
    var transportKind: ModelTransport = if (settings.forceBle) ModelTransport.LE else model.transportFor(isLeOnly(device))
      private set

    /** Every event of an LE link is also written to logcat under the JoyoFitBle tag; RFCOMM links log as before. */
    var linkEvents: WearEvents = if (transportKind == ModelTransport.LE) LogcatMirrorEvents(events) else events
      private set

    /** GB's HuaweiDeviceType for the link: BR, or BLE / AW over GATT. */
    var deviceType: HuaweiDeviceType = model.deviceType(transportKind)
      private set

    var transport: WatchTransport = openTransport(adapter)
      private set

    init {
      bindSession()
    }

    /**
     * Moves a Classic watch whose RFCOMM link did not open onto LE GATT (service 0xFE86), before any protocol traffic. Seen on
     * the Fit 4 Pro after a phone's Classic pairing went stale: SDP fails (`SDP_CFG_FAILED`) while LE still answers.
     */
    fun fallBackToLe() {
      transport.close()
      transportKind = ModelTransport.LE
      linkEvents = LogcatMirrorEvents(events)
      deviceType = model.deviceType(ModelTransport.LE)
      transport = openTransport(null)
      bindSession()
    }

    private fun bindSession() {
      session = HuaweiSession(transport, linkEvents)
      session.params.setTransactionsCrypted(model.crypted)
      // GB HuaweiSupportProvider: the AW70 bands send their workout records with their own layout.
      session.params.setAW(deviceType == HuaweiDeviceType.AW)
    }

    private fun openTransport(adapter: BluetoothAdapter?): WatchTransport = when (transportKind) {
      ModelTransport.BR -> RfcommTransport(
        adapter = checkNotNull(adapter),
        device = device,
        sdp = model.sdp,
        onData = { chunk -> session.onData(chunk) },
        onRemoteClosed = { cause -> onRemoteClosed(this, cause) },
      )
      ModelTransport.LE -> BleTransport(
        context = appContext,
        device = device,
        newHonorProtocol = model.newHonorProtocol,
        watchName = bondedName(device),
        onData = { chunk -> session.onData(chunk) },
        onRemoteClosed = { cause -> onRemoteClosed(this, cause) },
        log = { line -> events.log(LogDirection.INFO, null, null, null, line) },
      )
    }
  }

  fun currentState(): String = state.wire

  /** The live connection for sending notifications and profile data; null unless connected. */
  fun handle(): LinkHandle? = synchronized(lock) {
    val connection = current
    if (connection == null || connection.closed.get() || (state != LinkState.CONNECTED && state != LinkState.SYNCING)) null
    else connection.handle
  }

  /** The connected watch, as `connect` returned it; null unless connected. */
  fun deviceInfo(): Map<String, Any?>? = synchronized(lock) {
    val connection = current
    if (connection == null || (state != LinkState.CONNECTED && state != LinkState.SYNCING)) null else connection.info
  }

  /** The last watch this process connected to, as `connect` returned it; kept after it disconnects (support report). */
  @Volatile
  var lastDeviceInfo: Map<String, Any?>? = null
    private set

  /** The Bluetooth name of the watch of the last connect attempt, successful or not (support report). */
  @Volatile
  var lastAttemptName: String? = null
    private set

  /** The link opened in the last connect attempt, successful or not (support report). */
  @Volatile
  var lastAttemptTransport: ModelTransport? = null
    private set

  /** True until a HiChain bind with [address] has completed; a bind needs the user to confirm on the watch. */
  fun needsBind(address: String): Boolean = store.forDevice(address.trim().uppercase(Locale.ROOT)).isFirstConnection

  // Bluetooth access

  /**
   * True when [rawAddress] is a Classic watch that Android has no pairing with ([PairingState.missing]). Connecting to it would make
   * Android start a pairing, which only a connect the person opened may do; the background reconnect checks this first.
   */
  @SuppressLint("MissingPermission")
  fun needsPairing(rawAddress: String): Boolean {
    val address = rawAddress.trim().uppercase(Locale.ROOT)
    if (!BluetoothAdapter.checkBluetoothAddress(address)) return false
    val adapter = try {
      requireAdapter()
    } catch (e: WearException) {
      return false
    }
    val device = adapter.getRemoteDevice(address)
    return PairingState.missing(WatchModels.match(bondedName(device)), bondState(device))
  }

  /**
   * The rows of the Watch tab's list ([WatchListing]): Android's paired devices, the watch the link is on, the watch JoyoFit remembers
   * (listed even when Android does not list it as paired, so it connects by its stored address without a scan) and the last scan's names.
   */
  @SuppressLint("MissingPermission")
  fun bondedDevices(): List<Map<String, Any?>> {
    val adapter = requireAdapter()
    try {
      val paired = adapter.bondedDevices.map { SystemPaired(it.address, it.name) }
      val linked = synchronized(lock) {
        current?.let { conn ->
          DiscoveredDevice(
            address = conn.address,
            name = conn.info?.get("name") as? String ?: lastAttemptName ?: conn.address,
            model = conn.model.model?.name,
            support = conn.model.support.wire,
            reason = conn.model.reason,
            classic = conn.model.model?.let { it.transport == ModelTransport.BR },
          )
        }
      }
      val remembered = settings.watchAddress?.let { SystemPaired(it, settings.watchName) }
      return WatchListing.build(paired, linked, remembered, discoveredNames).map { it.toJs() }
    } catch (e: SecurityException) {
      throw WearException(ErrorCodes.BLUETOOTH_PERMISSION, "BLUETOOTH_CONNECT permission denied: ${e.message}", e)
    }
  }

  @SuppressLint("MissingPermission")
  fun startScan() {
    val adapter = requireAdapter()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      appContext.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED
    ) {
      throw WearException(
        ErrorCodes.BLUETOOTH_PERMISSION,
        "BLUETOOTH_SCAN permission is not granted; request it before scanning",
      )
    }

    val scanner = adapter.bluetoothLeScanner
      ?: throw WearException(ErrorCodes.BLUETOOTH_UNAVAILABLE, "Bluetooth LE scanner unavailable")

    synchronized(this) {
      if (isScanning) return
      // Each scan starts from nothing: devices an earlier scan saw (a watch that has since left or moved to another phone) must not stay listed.
      discoveredDevices.clear()
      discoveredNames.clear()
      isScanning = true
      scanHandler.removeCallbacks(scanTimeoutRunnable)
      scanHandler.postDelayed(scanTimeoutRunnable, SCAN_TIMEOUT_MS)
    }
    events.scanState(true, null)

    val callback = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult?) {
        val device = result?.device ?: return
        var rawName = try { device.name } catch (e: SecurityException) { null }
          ?: result.scanRecord?.deviceName
        val address = device.address

        val serviceUuids = result.scanRecord?.serviceUuids?.map { it.uuid.toString().lowercase(Locale.ROOT) } ?: emptyList()
        val isHuaweiService = serviceUuids.any { it.contains(SERVICE_FE86) || it.contains(SERVICE_3802) }
        val manufacturerData = result.scanRecord?.manufacturerSpecificData
        val isHuaweiManufacturer = manufacturerData != null &&
          (manufacturerData.get(HUAWEI_MANUFACTURER_ID) != null || manufacturerData.get(HONOR_MANUFACTURER_ID) != null)

        if (rawName.isNullOrBlank() && (isHuaweiService || isHuaweiManufacturer)) {
          rawName = "Huawei Wearable (${address.takeLast(5)})"
        }

        if (!rawName.isNullOrBlank()) {
          discoveredNames[address] = rawName
          val match = WatchModels.match(rawName)
          if (match.connectable || isHuaweiService || isHuaweiManufacturer) {
            val entry = DiscoveredDevice(
              address = address,
              name = rawName,
              model = match.model?.name,
              support = match.support.wire,
              reason = match.reason,
              rssi = result.rssi,
            )
            discoveredDevices[address] = entry
            events.deviceDiscovered(entry)
          }
        }
      }

      override fun onBatchScanResults(results: List<ScanResult?>) {
        results.forEach { it?.let { res -> onScanResult(0, res) } }
      }

      override fun onScanFailed(errorCode: Int) {
        synchronized(this@WearLink) {
          isScanning = false
          scanCallback = null
          scanHandler.removeCallbacks(scanTimeoutRunnable)
        }
        events.scanState(false, "BLE Scan failed with code $errorCode")
      }
    }

    scanCallback = callback
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .build()

    try {
      scanner.startScan(null, settings, callback)
    } catch (e: Exception) {
      synchronized(this) {
        isScanning = false
        scanCallback = null
        scanHandler.removeCallbacks(scanTimeoutRunnable)
      }
      events.scanState(false, e.message)
      throw WearException(ErrorCodes.CONNECT_FAILED, "Could not start BLE scan: ${e.message}", e)
    }
  }

  @SuppressLint("MissingPermission")
  fun stopScan() {
    val cb = synchronized(this) {
      if (!isScanning) return
      isScanning = false
      scanHandler.removeCallbacks(scanTimeoutRunnable)
      val c = scanCallback
      scanCallback = null
      c
    } ?: return

    try {
      val adapter = appContext.getSystemService(BluetoothManager::class.java)?.adapter
      adapter?.bluetoothLeScanner?.stopScan(cb)
    } catch (e: Exception) {
      // ignore
    } finally {
      events.scanState(false, null)
    }
  }

  fun getDiscoveredDevices(): List<Map<String, Any?>> {
    return discoveredDevices.values.sortedBy { it.name.lowercase(Locale.ROOT) }.map { it.toJs() }
  }

  private fun requireAdapter(): BluetoothAdapter {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      appContext.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
    ) {
      throw WearException(
        ErrorCodes.BLUETOOTH_PERMISSION,
        "BLUETOOTH_CONNECT permission is not granted; request it before using the watch",
      )
    }
    val adapter = appContext.getSystemService(BluetoothManager::class.java)?.adapter
      ?: throw WearException(ErrorCodes.BLUETOOTH_UNAVAILABLE, "This device has no Bluetooth adapter")
    if (!adapter.isEnabled) {
      throw WearException(ErrorCodes.BLUETOOTH_OFF, "Bluetooth is turned off; turn it on and try again")
    }
    return adapter
  }

  // Connect

  /**
   * Opens the link, authenticates and initializes. Every failure rejects with one coded [WearException] and leaves the link
   * `disconnected` (the transport released), so an immediate retry starts clean. [allowFirstBind] lets this attempt start a
   * first bind with the watch (which replaces its current phone pairing); without it the connect stops with
   * ERR_BIND_CONFIRMATION before anything on the watch changes. Only the interactive connect the user confirmed passes true.
   * [remember] false is a visit to a watch that is not the one background mode follows ([BackgroundController]): it neither
   * becomes the remembered watch nor touches its `device` row.
   */
  suspend fun connect(rawAddress: String, allowFirstBind: Boolean = false, remember: Boolean = true): Map<String, Any?> {
    stopScan()
    val address = rawAddress.trim().uppercase(Locale.ROOT)
    val adapter = requireAdapter()
    if (!BluetoothAdapter.checkBluetoothAddress(address)) {
      throw WearException(ErrorCodes.INVALID_ADDRESS, "'$rawAddress' is not a Bluetooth address")
    }

    val connection: Connection
    var joining: Connection? = null
    synchronized(lock) {
      val existing = current
      if (existing != null) {
        val info = existing.info
        if (existing.address == address) {
          if (info != null && (state == LinkState.CONNECTED || state == LinkState.SYNCING)) return info
          // Another caller (the background service or JS) is already connecting to this watch.
          if (info == null && !existing.closed.get()) joining = existing
        }
        if (joining == null) {
          throw WearException(
            ErrorCodes.BUSY,
            "Already ${state.wire} with ${existing.address}; disconnect before connecting again",
          )
        }
      }
      if (joining == null) {
        connection = prepare(address, adapter)
        lastAttemptName = bondedName(connection.device)
        lastAttemptTransport = connection.transportKind
        current = connection
        state = LinkState.CONNECTING
      } else {
        connection = joining
      }
    }
    joining?.let { return it.ready.await() }

    // Everything from here is inside the try: whatever fails, the connection is torn down and the link ends `disconnected`.
    try {
      events.state(LinkState.CONNECTING, null)
      val model = connection.model
      val link = when (connection.transportKind) {
        ModelTransport.BR -> "RFCOMM, SDP ${model.sdp}"
        ModelTransport.LE ->
          "Bluetooth LE GATT (${if (model.newHonorProtocol) "Honor service" else "service 0xFE86"}), device type ${connection.deviceType}"
      }
      connection.linkEvents.log(
        LogDirection.INFO,
        null,
        null,
        null,
        "Connecting to $address \"${lastAttemptName ?: "no name"}\": ${model.model?.name ?: "unknown model"} (${model.support.wire}), " +
          "$link${if (settings.forceBle) " (forced by the developer switch)" else ""}, encrypted ${model.crypted}, " +
          "Android pairing: ${PairingState.label(bondState(connection.device))}, " +
          "remembered ${settings.watchAddress.equals(address, ignoreCase = true)}" +
          if (allowFirstBind) ", first bind confirmed by the user" else "",
      )

      try {
        connection.transport.connect(Timeouts.CONNECT_MS)
      } catch (e: Exception) {
        if (connection.transportKind != ModelTransport.BR || connection.closed.get() || !shouldFallBackToLe(e)) throw e
        events.log(LogDirection.ERROR, null, null, null, "RFCOMM did not open (${e.message}); trying Bluetooth LE GATT")
        connection.fallBackToLe()
        synchronized(lock) { lastAttemptTransport = ModelTransport.LE }
        try {
          connection.transport.connect(Timeouts.LE_AFTER_RFCOMM_MS)
        } catch (le: WearException) {
          throw afterRfcommFailure(le, e)
        }
      }
      connection.linkEvents.log(LogDirection.INFO, null, null, null, "${connection.transportKind.label} connected")

      setState(connection, LinkState.AUTHENTICATING)
      val identity = store.forDevice(address)
      val authenticator = HuaweiAuthenticator(connection.session, identity, connection.linkEvents, connection.deviceType)
      val authMode = authenticator.authenticate(firstBindAllowed = allowFirstBind)

      setState(connection, LinkState.INITIALIZING)
      val init = HuaweiInitializer(
        session = connection.session,
        events = connection.linkEvents,
        bondedName = bondedName(connection.device),
        protocolVersion = authenticator.protocolVersion,
        profile = settings.profile,
        notificationsEnabled = settings.notificationsEnabled,
        healthSensors = settings.healthSensors,
        deviceType = connection.deviceType,
      ).run()

      val name = bondedName(connection.device) ?: init.deviceName ?: address
      val info = mapOf(
        "address" to address,
        "name" to name,
        "productModel" to init.productModel,
        "softwareVersion" to init.softwareVersion,
        "hardwareVersion" to init.hardwareVersion,
        "serialNumber" to init.serialNumber,
        "batteryLevel" to init.batteryLevel,
        "authMode" to authMode.wire,
        "model" to model.model?.name,
        "support" to model.support.wire,
      )

      synchronized(lock) {
        if (connection.closed.get() || current !== connection) {
          throw WearException(ErrorCodes.DISCONNECTED, "Disconnected while connecting")
        }
        connection.info = info
        lastDeviceInfo = info
        connection.handle = LinkHandle(address, connection.session, init.notificationState, connection.operationLock)
        state = LinkState.CONNECTED
      }
      if (remember) rememberWatch(address, name, info)
      events.state(LinkState.CONNECTED, null)
      init.batteryLevel?.let { events.battery(it) }
      connection.ready.complete(info)
      return info
    } catch (t: Throwable) {
      if (t is CancellationException) {
        teardown(connection, WearException(ErrorCodes.DISCONNECTED, "Connect cancelled"), null)
        throw t
      }
      // Closed under us (user disconnect, watch dropped the link): report what closed it rather than
      // the I/O error that followed. A protocol-level failure of the operation itself wins.
      val failure = PairingState.explain(connectFailure(t, connection.closeCause), connection.model, bondState(connection.device))
      val needsConfirmation = failure.errorCode == ErrorCodes.BIND_CONFIRMATION
      connection.linkEvents.log(
        if (needsConfirmation) LogDirection.INFO else LogDirection.ERROR,
        null,
        null,
        null,
        "Connect stopped [${failure.errorCode}]: ${failure.message}",
      )
      teardown(connection, failure, stateError(failure))
      throw failure
    }
  }

  /** The [Connection] for [address], or a coded failure: ERR_UNSUPPORTED for a watch this app does not drive, ERR_CONNECT_FAILED for anything Android refuses. */
  private fun prepare(address: String, adapter: BluetoothAdapter): Connection =
    try {
      val device = adapter.getRemoteDevice(address)
      val name = bondedName(device)
      val model = WatchModels.match(name)
      if (!model.connectable) throw WearException(ErrorCodes.UNSUPPORTED, "${name ?: address}: ${model.reason}")
      Connection(address, device, adapter, model)
    } catch (e: WearException) {
      throw e
    } catch (e: Exception) {
      throw WearException(ErrorCodes.CONNECT_FAILED, "Could not prepare the connection to $address: ${e.message ?: e.javaClass.simpleName}", e)
    }

  /** The watch becomes the one background mode follows, and gets its row in the shared database. */
  private fun rememberWatch(address: String, name: String, info: Map<String, Any?>) {
    settings.watchAddress = address
    settings.watchName = name
    try {
      syncStore.upsertDevice(address, name, info["productModel"] as String?, info["softwareVersion"] as String?)
    } catch (e: SQLiteException) {
      events.log(LogDirection.ERROR, null, null, null, "Could not store the watch in the database: ${e.message}")
    }
  }

  /** Android's name for [device]; when it has none cached (it sometimes drops it), the name remembered for that watch's address. */
  @SuppressLint("MissingPermission")
  private fun bondedName(device: BluetoothDevice): String? =
    try {
      device.name
    } catch (e: SecurityException) {
      null
    } ?: settings.watchName.takeIf { settings.watchAddress.equals(device.address, ignoreCase = true) }

  /** True when Android knows [device] as Bluetooth LE only, so it has no Classic side to open an RFCOMM socket on. */
  @SuppressLint("MissingPermission")
  private fun isLeOnly(device: BluetoothDevice): Boolean =
    try {
      device.type == BluetoothDevice.DEVICE_TYPE_LE
    } catch (e: SecurityException) {
      false
    }

  /** Android's pairing state of [device] (`BluetoothDevice.BOND_*`); null when it cannot be read. Only read, never changed. */
  @SuppressLint("MissingPermission")
  private fun bondState(device: BluetoothDevice): Int? =
    try {
      device.bondState
    } catch (e: SecurityException) {
      null
    }

  // Disconnect / teardown

  /** True while a sync, battery read or watch face operation holds the live connection's operation lock. */
  fun operationRunning(): Boolean = synchronized(lock) { current?.operationLock?.isLocked == true }

  fun disconnect() {
    val connection = synchronized(lock) { current } ?: return
    events.log(LogDirection.INFO, null, null, null, "Disconnecting from ${connection.address}")
    teardown(connection, WearException(ErrorCodes.DISCONNECTED, "Disconnected"), null)
  }

  /** [disconnect], but only when the link (or the attempt in progress) is with [address]: a visit never tears down someone else's link. */
  fun disconnectIfConnectedTo(address: String) {
    val connection = synchronized(lock) { current }?.takeIf { it.address == address } ?: return
    events.log(LogDirection.INFO, null, null, null, "Disconnecting from ${connection.address}")
    teardown(connection, WearException(ErrorCodes.DISCONNECTED, "Disconnected"), null)
  }

  /** JS reload / module destroy: close without telling JS. */
  fun shutdown() = disconnect()

  fun forget(rawAddress: String) {
    val address = rawAddress.trim().uppercase(Locale.ROOT)
    val connection = synchronized(lock) { current }
    if (connection != null && connection.address == address) {
      teardown(connection, WearException(ErrorCodes.DISCONNECTED, "Device forgotten"), null)
    }
    store.forget(address)
    events.log(LogDirection.INFO, null, null, null, "Forgot $address: stored auth key and fake identity cleared")
  }

  private fun onRemoteClosed(connection: Connection, cause: IOException?) {
    val reason = "Connection lost: ${cause?.message ?: "closed by the watch"}"
    events.log(LogDirection.ERROR, null, null, null, reason)
    teardown(connection, WearException(ErrorCodes.DISCONNECTED, reason, cause), reason)
  }

  /**
   * Idempotent. Fails in-flight requests with [cause]; reports `disconnected` with [error] to JS. Whatever the transport does while
   * closing, the link still ends `disconnected`, so a failed close can never leave the next connect answering BUSY.
   */
  private fun teardown(connection: Connection, cause: WearException, error: String?) {
    if (!connection.closed.compareAndSet(false, true)) return
    connection.closeCause = cause
    connection.ready.completeExceptionally(cause)
    try {
      connection.session.close(cause)
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "Closing the session failed: ${e.message ?: e.javaClass.simpleName}")
    }
    try {
      connection.transport.close()
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "Closing the ${connection.transportKind.label} link failed: ${e.message ?: e.javaClass.simpleName}")
    }
    val wasCurrent = synchronized(lock) {
      if (current === connection) {
        current = null
        state = LinkState.DISCONNECTED
        true
      } else {
        false
      }
    }
    if (wasCurrent) events.state(LinkState.DISCONNECTED, error)
  }

  private fun setState(connection: Connection, next: LinkState) {
    synchronized(lock) {
      if (current !== connection || connection.closed.get()) {
        throw WearException(ErrorCodes.DISCONNECTED, "Disconnected while ${state.wire}")
      }
      state = next
    }
    events.state(next, null)
  }

  // Operations on a connected watch

  private fun requireConnected(): Connection = synchronized(lock) {
    val connection = current
    if (connection == null || (state != LinkState.CONNECTED && state != LinkState.SYNCING)) {
      throw WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch (state: ${state.wire})")
    }
    connection
  }

  suspend fun refreshBattery(): Int {
    val connection = requireConnected()
    return connection.operationLock.withLock {
      val level = connection.session.queryBattery(Timeouts.QUERY_MS)
      events.battery(level)
      level
    }
  }

  /**
   * Pulls sleep, steps and totals since the last stored sync (everything the watch holds on the first sync), commits
   * them to the shared database slice by slice and reports a summary (also as `onSyncComplete`). [fullHistory] pulls
   * everything again; stored rows upsert, so it only adds what is missing. Logs a `History:` summary with the oldest
   * stored timestamps (logcat tag `JoyoFit`) so the watch's real retention can be read off it.
   */
  suspend fun syncActivity(fullHistory: Boolean = false): SyncSummary {
    val connection = requireConnected()
    if (state == LinkState.SYNCING) {
      throw WearException(ErrorCodes.BUSY, "A sync is already running")
    }
    val summary = connection.operationLock.withLock {
      synchronized(lock) {
        if (current !== connection || state != LinkState.CONNECTED) {
          throw WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch (state: ${state.wire})")
        }
        state = LinkState.SYNCING
      }
      events.state(LinkState.SYNCING, null)
      try {
        if (!storage { syncStore.tracksHealth(connection.address) }) return@withLock syncWithoutHealth(connection)
        val last = if (fullHistory) null else storage { syncStore.lastSync(connection.address) }
        val nowSec = System.currentTimeMillis() / 1000
        val slices = syncSlices(syncWindowStart(last), nowSec)
        events.log(LogDirection.INFO, null, null, null, "History: ${if (fullHistory) "full" else "incremental"} pull in ${slices.size} slices from ${slices.first().first}")
        var stored: SyncSummary? = null
        var samples = 0
        var sleep = 0
        var oldestSample: Long? = null
        var oldestSleep: Long? = null
        for ((index, slice) in slices.withIndex()) {
          val result = ActivitySync(connection.session, events).sync(slice.first, slice.second)
          val slicePart = storage { syncStore.save(connection.address, result) }
          samples += slicePart.samples
          sleep += slicePart.sleep
          result.samples.minOfOrNull { it.timestamp }?.let { oldestSample = minOf(oldestSample ?: it, it) }
          result.sleep.minOfOrNull { it.start }?.let { oldestSleep = minOf(oldestSleep ?: it, it) }
          events.log(
            LogDirection.INFO, null, null, null,
            "History: slice ${index + 1}/${slices.size} ${slice.first}..${slice.second}: ${slicePart.samples} step samples, ${slicePart.sleep} sleep segments",
          )
          stored = slicePart
        }
        val finalSlice = stored!!
        val workoutsSynced = syncWorkouts(connection, fullHistory)
        val summary = SyncSummary(
          from = slices.first().first,
          to = finalSlice.to,
          samples = samples,
          sleep = sleep,
          totalSteps = finalSlice.totalSteps,
          totalCalories = finalSlice.totalCalories,
          totalDistance = finalSlice.totalDistance,
          workouts = workoutsSynced,
        )
        val oldestWorkout = storage {
          syncStore.read { db ->
            db.rawQuery("SELECT MIN(start) FROM workouts", null).use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null }
          }
        }
        events.log(
          LogDirection.INFO, null, null, null,
          "History: summary oldest step sample ${oldestSample ?: "none"}, oldest sleep ${oldestSleep ?: "none"}, " +
            "oldest stored workout ${oldestWorkout ?: "none"}; $samples step samples, $sleep sleep segments, $workoutsSynced workouts written",
        )
        syncNightHrv(connection, fullHistory)
        postMorningSummary()
        for (extension in syncExtensions) {
          try {
            extension(connection.session)
          } catch (e: CancellationException) {
            throw e
          } catch (e: WearException) {
            if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
            events.log(LogDirection.ERROR, null, null, null, "Sync extension failed: ${e.message}")
          } catch (e: Exception) {
            events.log(LogDirection.ERROR, null, null, null, "Sync extension failed: ${e.message ?: e.javaClass.simpleName}")
          }
        }
        summary
      } finally {
        val restored = synchronized(lock) {
          if (current === connection && state == LinkState.SYNCING) {
            state = LinkState.CONNECTED
            true
          } else {
            false
          }
        }
        if (restored) events.state(LinkState.CONNECTED, null)
      }
    }
    events.syncComplete(summary)
    return summary
  }

  /**
   * The sync of a watch whose `tracks_health` is off (a family member's band, a guest watch): no step, sleep, workout,
   * night HRV or health metric row is stored and no extension runs, but the sync still counts (`device.last_sync`) and
   * completes with zero totals; the caller refreshes the battery as for any sync.
   */
  private suspend fun syncWithoutHealth(connection: Connection): SyncSummary {
    val nowSec = System.currentTimeMillis() / 1000
    storage { syncStore.touchLastSync(connection.address, nowSec) }
    events.log(LogDirection.INFO, null, null, null, "History: ${connection.address} does not track health, no rows stored")
    return SyncSummary(from = nowSec, to = nowSec, samples = 0, sleep = 0, totalSteps = 0, totalCalories = 0, totalDistance = 0)
  }

  /** Database access off the caller's thread; a failed read or write surfaces as ERR_STORAGE. */
  private suspend fun <T> storage(block: () -> T): T =
    try {
      withContext(Dispatchers.IO) { block() }
    } catch (e: SQLiteException) {
      throw WearException(ErrorCodes.STORAGE, "Database error: ${e.message}", e)
    }

  /**
   * Workout sessions and their GPS tracks, after the activity data is stored. Whatever fails here is logged and
   * does not fail the sync: the steps, sleep and totals are already committed.
   */
  private suspend fun syncWorkouts(connection: Connection, fullHistory: Boolean): Int {
    val workouts = WorkoutStore(syncStore, connection.address)
    val sync = WorkoutSync(connection.session, events)
    try {
      val now = (System.currentTimeMillis() / 1000).toInt()
      sync.sync(workouts.syncStart(fullHistory), now, workouts)
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "Workout sync failed: ${e.message ?: e.javaClass.simpleName}")
    }
    events.log(LogDirection.INFO, null, null, null, "Workout sync: ${sync.saved} workouts stored")
    return sync.saved
  }

  /** The morning summary notification, after the night's sleep and HRV are stored; never fails the sync. */
  private suspend fun postMorningSummary() {
    try {
      MorningSummary.postIfDue(appContext, settings, syncStore, events)
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "Morning summary failed: ${e.message ?: e.javaClass.simpleName}")
    }
  }

  /**
   * Nightly HRV from the watch's stress records, after the sleep is stored. Whatever fails here is logged and does not fail
   * the sync; only a lost link ends it.
   */
  private suspend fun syncNightHrv(connection: Connection, fullHistory: Boolean) {
    try {
      NightHrvSync(connection.session, events, syncStore, settings, connection.address).sync(System.currentTimeMillis() / 1000, fullHistory)
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      events.log(LogDirection.ERROR, null, null, null, "Night HRV failed [${e.errorCode}]: ${e.message}")
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "Night HRV failed: ${e.message ?: e.javaClass.simpleName}")
    }
  }
}

/** Developer LE mode: every log line of the link (packets, auth and init steps, errors) also goes to logcat under the JoyoFitBle tag. */
private class LogcatMirrorEvents(private val delegate: WearEvents) : WearEvents by delegate {
  override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
    val command = if (serviceId != null && commandId != null) " %02x/%02x".format(serviceId, commandId) else ""
    val packet = if (hex != null) " ${hex.take(HEX_CHARS)}${if (hex.length > HEX_CHARS) "..." else ""}" else ""
    android.util.Log.i("JoyoFitBle", "[${direction.wire}]$command $message$packet")
    delegate.log(direction, serviceId, commandId, hex, message)
  }

  private companion object {
    const val HEX_CHARS = 96
  }
}
