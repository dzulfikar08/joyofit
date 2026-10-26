// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/{HuaweiP2PManager,requests/SendP2PCommand,
// AsynchronousResponse.handleP2p} and the HuaweiSupportProvider code that registers the P2P services after init.
package com.joyodigitama.huaweiwear

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.P2P
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.HuaweiP2PManager
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiP2PDataDictionarySyncService

/**
 * The P2P service (0x34/0x01) of one connection: GB's [HuaweiP2PManager] on top of a [HuaweiSession].
 *
 * Every 0x34/0x01 packet the watch sends (pings, data, acknowledgements of ours) reaches the session's
 * subscriber, which only queues it; one coroutine parses and dispatches them in order, one coroutine writes
 * the outgoing packets in order, so the ported Java services run single-threaded like in GB and never block
 * the read thread.
 *
 * GB registers its P2P services when init has finished (`initializeDynamicServices`); [P2pController] does the
 * same when the link reaches CONNECTED, through [registerServices].
 */
internal class P2pStack(
  private val session: HuaweiSession,
  private val events: WearEvents,
  private val settings: P2pSettings,
  private val healthModelFactory: (HuaweiP2PManager) -> HealthModelService,
  /** Age for the default heart-rate zones, read at each send (the profile can change). */
  private val heartRateAge: () -> Int,
  /** The zones the user set in the app, read at each send; null = the age defaults. */
  private val heartRateUser: () -> HeartRateZonesCalc.UserZones?,
  /** The quick replies service when this watch takes them; the controller owns the stored list. */
  private val quickRepliesFactory: (HuaweiP2PManager) -> QuickRepliesService,
) : HuaweiP2PManager.Transport {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private val inbound = Channel<HuaweiPacket>(Channel.UNLIMITED)
  private val outbound = Channel<HuaweiPacket>(Channel.UNLIMITED)
  private var subscription: AutoCloseable? = null

  val manager = HuaweiP2PManager(this)

  @Volatile
  private var trackService: TrackService? = null

  @Volatile
  var quickReplies: QuickRepliesService? = null
    private set

  @Volatile
  var dictionary: HuaweiP2PDataDictionarySyncService? = null
    private set

  @Volatile
  var healthModel: HealthModelService? = null
    private set

  @Volatile
  var dictionaryPing: Int? = null
    private set

  /** The Petal Maps companion probe (lab, [PetalProbeWire]); null unless its switch is on. */
  @Volatile
  var petalProbe: PetalMapsProbeService? = null
    private set
  private var petalProbeHook: AutoCloseable? = null

  fun start() {
    subscription = session.subscribe(P2P.id, P2P.P2PCommand.id, "P2P") { inbound.trySend(it) }
    scope.launch {
      for (packet in inbound) {
        try {
          dispatch(packet)
        } catch (e: CancellationException) {
          throw e
        } catch (e: Exception) {
          events.log(LogDirection.ERROR, P2P.id.toInt(), P2P.P2PCommand.id.toInt(), null, "P2P: handling a packet failed: ${e.message ?: e.javaClass.simpleName}")
        }
      }
    }
    scope.launch {
      for (packet in outbound) {
        try {
          session.send(packet, "P2P")
        } catch (e: CancellationException) {
          throw e
        } catch (e: WearException) {
          if (e.errorCode != ErrorCodes.DISCONNECTED) log("P2P send failed: ${e.message}", error = true)
        }
      }
    }
  }

  private fun dispatch(packet: HuaweiPacket) {
    packet.parseTlv()
    val response = packet as? P2P.P2PCommand.Response
    if (response == null) {
      log("P2P packet could not be decoded (service ${packet.serviceId.hex2()} command ${packet.commandId.hex2()})", error = true)
      return
    }
    manager.handlePacket(response)
  }

  /** GB's registration block of `initializeDynamicServices`, limited to the services JoyoFit has. */
  fun registerServices() {
    val capsLine = "P2P: SupportedCommands 34/01=${DeviceCaps.supports(0x34, 0x01)}"
    if (!DeviceCaps.supports(0x34, 0x01)) {
      log("$capsLine; the watch does not list the P2P service (GB supportsP2PService), no P2P service registered")
      return
    }
    log("$capsLine; registering P2P services")

    val dictionary = HuaweiP2PDataDictionarySyncService(manager)
    dictionary.setAvailabilityListener { code ->
      dictionaryPing = code
      log("P2P dictionary sync: ping answered 0x%02x (0xca = the watch app is there)".format(code and 0xFF))
    }
    this.dictionary = dictionary
    dictionary.register()

    val bit37 = DeviceCaps.expandCapability(37)
    if (!bit37) {
      log("Healthy Living: ExpandCapability 37 is not set, the watch will not ask for tasks; service not registered")
    } else if (!settings.healthLivingEnabled) {
      log("Healthy Living: switched off in the app; service not registered")
    } else {
      log("Healthy Living: ExpandCapability 37 set (Huawei's gate); registering module healthmodel")
      val service = healthModelFactory(manager)
      healthModel = service
      service.register()
    }

    log(HeartRateZonesSync.capsLine())
    if (HeartRateZonesSync.supportsTrack) {
      val service = TrackService(manager, events, heartRateAge, heartRateUser)
      trackService = service
      service.register()
    }
    registerQuickReplies()
  }

  fun registerQuickReplies() {
    if (!DeviceCaps.expandCapability(QuickRepliesPacket.CAPABILITY_BIT)) {
      log("Quick replies: ExpandCapability ${QuickRepliesPacket.CAPABILITY_BIT} is not set; service not registered")
      return
    }
    val service = quickRepliesFactory(manager)
    quickReplies = service
    service.register()
  }

  /** Registers the Petal Maps companion probe and its listeners for unhandled frames; [P2pController] checks the lab switch. */
  @Synchronized
  fun registerPetalProbe() {
    if (petalProbe != null) return
    if (!DeviceCaps.supports(0x34, 0x01)) {
      log("${PetalProbeWire.TAG} the watch does not list the P2P service (34/01); probe not registered")
      return
    }
    val service = PetalMapsProbeService(manager, { log(it) })
    petalProbe = service
    manager.setUnclaimedListener { service.onUnclaimed(it) }
    petalProbeHook = session.observeUnhandled { s, c, tlv, raw -> service.onUnhandled(s, c, tlv, raw) }
    service.register()
  }

  @Synchronized
  fun unregisterPetalProbe() {
    if (petalProbe == null) return
    petalProbeHook?.close()
    petalProbeHook = null
    manager.setUnclaimedListener(null)
    manager.unregisterService(PetalProbeWire.PHONE_PACKAGE)
    petalProbe = null
    log("${PetalProbeWire.TAG} unregistered")
  }

  /** Re-sends the zones after the profile age or the zone configuration changed; false when nothing went out (another way, or invalid). */
  fun resendHeartRateZones(): Boolean = trackService?.resend() ?: false

  fun close() {
    subscription?.close()
    subscription = null
    petalProbeHook?.close()
    petalProbeHook = null
    manager.unregisterAllService()
    inbound.close()
    outbound.close()
    scope.cancel()
  }

  // HuaweiP2PManager.Transport

  override fun sendP2P(
    cmdId: Byte,
    sequence: Short,
    srcPackage: String?,
    dstPackage: String?,
    srcFingerprint: String?,
    dstFingerprint: String?,
    sendData: ByteArray?,
    sendCode: Int,
  ) {
    val packet = try {
      P2P.P2PCommand.Request(session.params, cmdId, sequence, srcPackage, dstPackage, srcFingerprint, dstFingerprint, sendData, sendCode)
    } catch (e: Exception) {
      throw IOException("P2P request could not be built: ${e.message}", e)
    }
    outbound.trySend(packet)
  }

  override fun supportsExpandCapability(which: Int): Boolean = DeviceCaps.expandCapability(which)

  override fun log(message: String) = events.log(LogDirection.INFO, P2P.id.toInt(), P2P.P2PCommand.id.toInt(), null, message)

  private fun log(message: String, error: Boolean) =
    events.log(if (error) LogDirection.ERROR else LogDirection.INFO, P2P.id.toInt(), P2P.P2PCommand.id.toInt(), null, message)
}
