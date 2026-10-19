// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiSupportProvider.initializeDevice* and
// service/devices/huawei/requests/{GetLinkParams,GetDeviceStatus,GetSecurityNegotiation,GetPincode,GetHiChain,GetAuth,GetBondParams,GetBond}Request.
package com.joyodigitama.huaweiwear

import android.os.Build
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import kotlinx.coroutines.CancellationException
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiConstants
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCoordinator.HuaweiDeviceType
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCrypto
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.DeviceConfig
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.DeviceConfig.HiChain
import nodomain.freeyourgadget.gadgetbridge.util.CryptoUtils
import nodomain.freeyourgadget.gadgetbridge.util.StringUtils

internal object Timeouts {
  const val CONNECT_MS = 20_000L

  /**
   * How long the Bluetooth LE attempt that follows a Classic watch's failed RFCOMM connect waits for the watch in its last
   * (autoConnect) attempt. A Classic watch is not LE-first, so this only checks that it answers over LE; an LE band waits [CONNECT_MS].
   */
  const val LE_AFTER_RFCOMM_MS = 8_000L

  /** Auth-phase requests on a reconnect. GB sets none; a silent watch would hang forever. */
  const val AUTH_MS = 10_000L

  /** First bind: the user confirms the pairing on the watch (GB `firstAuthenticateTimeout`). */
  const val FIRST_AUTH_MS = 30_000L

  /** GB `GetHiChainRequest.authenticateTimeout`: first step of the operationCode 2 exchange. */
  const val HICHAIN_AUTH_FIRST_STEP_MS = 5_000L

  /** Later steps of the operationCode 2 exchange (GB sets no timeout). */
  const val HICHAIN_AUTH_STEP_MS = 10_000L

  /** GB `HuaweiSupportProvider.initTimeout`: a missing reply only skips to the next init request. */
  const val INIT_MS = 2_000L

  /** User-triggered single queries (battery refresh). */
  const val QUERY_MS = 5_000L

  const val SYNC_COUNT_MS = 10_000L
  const val SYNC_DATA_MS = 15_000L
}

/** Where the developer bind lab ([BindLab]) ends an authentication on purpose; the steps after it are never sent. */
internal enum class BindStop {
  /** After LinkParams and SecurityNegotiation: only queries that change nothing on the watch. */
  SECURITY_NEGOTIATION,

  /** After the PinCode query, before the first HiChain message. */
  PIN_CODE,

  /** After HiChain operationCode 1 step 2 (the watch's returnCodeMac verified), before step 3 delivers the auth token. */
  ISO_MAC_VERIFIED,
}

/**
 * Bind lab options: [stopAfter] ends the authentication with an ERR_PROTOCOL; a lab also traces this session's secrets to the log.
 * [linkSlice] and [linkMtu] put those numbers into the LinkParams request (GB sends it empty) to see whether the watch then sends
 * its replies in smaller pieces.
 */
internal class AuthLab(val stopAfter: BindStop?, val linkSlice: Int? = null, val linkMtu: Int? = null) {
  fun reached(stage: BindStop) {
    if (stage == stopAfter) throw WearException(ErrorCodes.PROTOCOL, "Bind lab stopped after $stage on purpose")
  }

  fun trace(events: WearEvents, message: String) = events.log(LogDirection.INFO, null, null, null, "Lab: $message")
}

/**
 * Port of the HuaweiSupportProvider.initializeDevice* chain:
 * LinkParams -> DeviceStatus -> SecurityNegotiation -> HiChain / HiChain Lite / normal auth.
 * Requests are the ones in service/devices/huawei/requests (GetLinkParamsRequest, ...); each
 * `processResponse()` is inlined after the matching `session.request`. [deviceType] is GB's HuaweiDeviceType: BR
 * (RFCOMM) is the path the Fit 4 Pro runs; BLE and AW (Bluetooth LE) differ in the LinkParams request, in skipping
 * the device status check (BLE only) and in the BondParams and Bond steps after normal mode.
 */
internal class HuaweiAuthenticator(
  private val session: HuaweiSession,
  private val identity: DeviceIdentity,
  private val events: WearEvents,
  private val deviceType: HuaweiDeviceType = HuaweiDeviceType.BR,
  private val lab: AuthLab? = null,
  private val androidSdk: Int = Build.VERSION.SDK_INT,
) {
  private val params get() = session.params
  private val random = SecureRandom()

  /** LinkParams protocolVersion (GB `HuaweiSupportProvider.getProtocolVersion()`); valid after [authenticate]. */
  var protocolVersion: Int = 0
    private set

  /**
   * Runs the whole authentication. Throws [WearException]: ERR_AUTH_FAILED (GB-style reason in the
   * message), ERR_TIMEOUT, ERR_DEVICE_STATUS, ERR_DISCONNECTED or, when a HiChain first bind is needed while [firstBindAllowed]
   * is false, ERR_BIND_CONFIRMATION. That stop comes before the PinCode request, so nothing on the watch has changed. Normal
   * mode, HiChain Lite and a HiChain reconnect with a key the watch knows never ask for it.
   */
  suspend fun authenticate(firstBindAllowed: Boolean): AuthMode {
    try {
      return negotiate(firstBindAllowed)
    } catch (e: WearException) {
      throw when (e.errorCode) {
        ErrorCodes.PROTOCOL -> WearException(ErrorCodes.AUTH_FAILED, "Authentication failed: ${e.message}", e)
        ErrorCodes.TIMEOUT -> WearException(ErrorCodes.TIMEOUT, "Authentication timed out: ${e.message}", e)
        else -> e
      }
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      throw WearException(ErrorCodes.AUTH_FAILED, "Authentication failed: ${e.message ?: e.javaClass.simpleName}", e)
    }
  }

  private suspend fun negotiate(firstBindAllowed: Boolean): AuthMode {
    var firstConnection = identity.isFirstConnection
    var authTimeout = if (firstConnection) Timeouts.FIRST_AUTH_MS else Timeouts.AUTH_MS

    // GB initializeDevice(): fake MAC / android id are created before the first request.
    identity.ensureCreated()

    val serverNonce = linkParams()

    // GB initializeDeviceCheckStatus (askStatus = true). GB skips it for HuaweiDeviceType.BLE ("only BLE known, check later for
    // AW and SMART") and goes straight to the security negotiation.
    if (deviceType != HuaweiDeviceType.BLE) {
      val status = deviceStatus()
      if (status != -1 && status != 0 && status != 1) {
        // GB calls initializeDeviceNotify(), an empty TODO, so the connection silently hangs.
        throw WearException(
          ErrorCodes.DEVICE_STATUS,
          "Watch reported unexpected device status $status (0x%02x); expected -1, 0 or 1".format(status and 0xFF),
        )
      }
    }

    // GB initializeDeviceDealHiChain.
    if (!isHiChain()) {
      events.log(LogDirection.INFO, null, null, null, "Auth: normal mode")
      normalMode(serverNonce, authTimeout)
      return AuthMode.NORMAL
    }

    params.setAuthMode(if (params.deviceSupportType.toInt() == 4) 4.toByte() else 2.toByte())
    val authType = securityNegotiation(authTimeout)
    lab?.reached(BindStop.SECURITY_NEGOTIATION)

    val mode: AuthMode
    if (authType == 0x0186A0 || isHiChain3(authType)) {
      mode = if (params.deviceSupportType.toInt() == 4 || isHiChain3(authType)) AuthMode.HICHAIN3 else AuthMode.HICHAIN
      val decision = FirstBind.decide(params.authMode.toInt(), authType, firstConnection)
      if (decision.firstConnection != firstConnection) authTimeout = if (decision.firstConnection) Timeouts.FIRST_AUTH_MS else Timeouts.AUTH_MS
      firstConnection = decision.firstConnection
      events.log(LogDirection.INFO, null, null, null, "Auth: ${decision.note}")
      events.log(LogDirection.INFO, null, null, null, "Auth: ${mode.wire} mode (authType=$authType, firstConnection=$firstConnection)")
      if (FirstBind.needsConfirmation(firstConnection, firstBindAllowed)) {
        // Decided before the PinCode request: the watch has not been touched.
        events.log(LogDirection.INFO, null, null, null, "Auth: a first bind is needed; this connection may not start one")
        throw WearException(ErrorCodes.BIND_CONFIRMATION, FirstBind.MESSAGE)
      }
      hiChainMode(firstConnection, authTimeout)
    } else if (authType == 0x01 || authType == 0x02) {
      mode = AuthMode.HICHAIN_LITE
      events.log(LogDirection.INFO, null, null, null, "Auth: hichain-lite mode (authType=$authType)")
      hiChainLiteMode(serverNonce, authTimeout)
    } else {
      // GB falls through finalizeSecurityNegotiationHiChain without doing anything.
      throw WearException(ErrorCodes.PROTOCOL, "Unsupported security negotiation authType $authType")
    }
    return mode
  }

  // GetLinkParamsRequest

  private suspend fun linkParams(): ByteArray {
    val response = session
      .request(linkParamsRequest(), Timeouts.AUTH_MS, "LinkParams")
      .expect<DeviceConfig.LinkParams.Response>("LinkParams")

    params.setDeviceSupportType(response.deviceSupportType)
    params.setSliceSize(response.sliceSize.toInt())
    params.setMtu(response.mtu.toInt())
    params.setAuthVersion(response.authVersion)
    params.setAuthAlgo(response.authAlgo)
    params.setEncryptMethod(response.encryptMethod)
    protocolVersion = response.protocolVersion.toInt() and 0xFF
    events.log(
      LogDirection.INFO,
      null,
      null,
      null,
      "LinkParams: protocolVersion=${response.protocolVersion.hex2()} deviceSupportType=${response.deviceSupportType.hex2()} " +
        "authVersion=${response.authVersion.hex2()} authAlgo=${response.authAlgo.hex2()} encryptMethod=${response.encryptMethod.hex2()} " +
        "bondState=${response.bondState.hex2()} mtu=${response.mtu} sliceSize=${response.sliceSize}",
    )
    return response.serverNonce
  }

  private fun linkParamsRequest(): DeviceConfig.LinkParams.Request {
    val request = DeviceConfig.LinkParams.Request(params, deviceType)
    val slice = lab?.linkSlice
    val mtu = lab?.linkMtu
    if (slice != null || mtu != null) {
      val tlv = HuaweiTLV().put(0x01)
      if (slice != null) tlv.put(0x02, slice.toShort()) else tlv.put(0x02)
      if (mtu != null) tlv.put(0x03, mtu.toShort()) else tlv.put(0x03)
      request.setTlv(tlv.put(0x04))
    }
    return request
  }

  // GetDeviceStatusRequest

  private suspend fun deviceStatus(): Int {
    val response = session
      .request(DeviceConfig.DeviceStatus.Request(params, true), Timeouts.AUTH_MS, "DeviceStatus")
      .expect<DeviceConfig.DeviceStatus.Response>("DeviceStatus")
    return response.status.toInt()
  }

  // HuaweiSupportProvider.isHiChain / isHiChainLite / isHiChain3

  private fun isHiChain(): Boolean {
    val type = params.deviceSupportType.toInt()
    return type == 0x01 || type == 0x03 || type == 0x04 || isHiChainLite()
  }

  private fun isHiChainLite(): Boolean = params.deviceSupportType.toInt() == 0x02

  private fun isHiChain3(authType: Int): Boolean = (authType xor 0x01) == 0x04 || (authType xor 0x02) == 0x04

  // GetSecurityNegotiationRequest (non-Honor variant)

  private suspend fun securityNegotiation(timeoutMs: Long): Int {
    val request = DeviceConfig.SecurityNegotiation.Request(
      params,
      params.authMode,
      identity.androidIdBytes,
      Build.MODEL,
    )
    val response = session
      .request(request, timeoutMs, "SecurityNegotiation")
      .expect<DeviceConfig.SecurityNegotiation.Response>("SecurityNegotiation")
    lab?.trace(events, "SecurityNegotiation: authType=${response.authType} honorPairType=${response.honorPairType} tlv=${response.tlv}")
    return response.authType
  }

  // GetPincodeRequest

  private suspend fun pinCode(timeoutMs: Long) {
    val response = session
      .request(DeviceConfig.PinCode.Request(params), timeoutMs, "PinCode")
      .expect<DeviceConfig.PinCode.Response>("PinCode")
    params.setPinCode(response.pinCode)
    lab?.trace(events, "PinCode: ${response.pinCode.size} bytes ${response.pinCode.toHex()}")
  }

  // initializeDeviceHiChainMode

  private suspend fun hiChainMode(firstConnection: Boolean, authTimeout: Long) {
    if (firstConnection) {
      pinCode(authTimeout)
      lab?.reached(BindStop.PIN_CODE)
      // operationCode 1 (GB logs it as the "auth operation": PIN-derived key, the user confirms on the
      // watch, stores the auth token), then operationCode 2 (GB's "bind operation").
      hiChain(operationCode = 0x01)
    }
    hiChain(operationCode = 0x02)
    identity.markBonded()
  }

  /**
   * GetHiChainRequest: one four-step ISO exchange. `operationCode` 1 = first-time pairing (PIN-derived
   * key, stores the auth token), 2 = authentication with the stored auth key, which derives the
   * session key. The request chain `step += 1` after each response is the loop below.
   */
  private suspend fun hiChain(operationCode: Int) {
    val pairing = operationCode == 0x01
    val firstStepTimeout = if (pairing) Timeouts.FIRST_AUTH_MS else Timeouts.HICHAIN_AUTH_FIRST_STEP_MS
    val stepTimeout = if (pairing) Timeouts.FIRST_AUTH_MS else Timeouts.HICHAIN_AUTH_STEP_MS

    var step = 0x01
    var requestId = 0x00L
    var chain: HiChain.Request? = null
    var authIdSelf = ByteArray(0)
    var authIdPeer = ByteArray(0)
    var randSelf = ByteArray(0)
    var randPeer = ByteArray(0)
    var seed = ByteArray(0)
    var challenge = ByteArray(0)
    var psk = ByteArray(0)
    var sessionKey = ByteArray(0)

    while (true) {
      // GetHiChainRequest.createRequest
      if (requestId == 0x00L) requestId = System.currentTimeMillis()
      val label = "HiChain op$operationCode step $step"
      val current = chain ?: HiChain.Request(
        operationCode,
        requestId,
        identity.androidIdBytes,
        HuaweiConstants.GROUP_ID,
      ).also { chain = it }

      val messageId = step
      var packet: HuaweiPacket? = null
      try {
        if (step == 0x01) {
          seed = ByteArray(32).also(random::nextBytes)
          randSelf = ByteArray(16).also(random::nextBytes)
          packet = current.StepOne(params, messageId, randSelf, seed)
        } else if (step == 0x02) {
          val message = ByteBuffer
            .allocate(randPeer.size + randSelf.size + authIdSelf.size + authIdPeer.size)
            .put(randSelf)
            .put(randPeer)
            .put(authIdPeer)
            .put(authIdSelf)
            .array()
          val selfToken = CryptoUtils.calcHmacSha256(psk, message)
          packet = current.StepTwo(params, messageId, selfToken)
        } else if (step == 0x03) {
          val salt = ByteBuffer
            .allocate(randSelf.size + randPeer.size)
            .put(randSelf)
            .put(randPeer)
            .array()
          val info = "hichain_iso_session_key".toByteArray(StandardCharsets.UTF_8)
          sessionKey = CryptoUtils.hkdfSha256(psk, salt, info, 32)
          if (operationCode == 0x01) {
            val nonce = ByteArray(12).also(random::nextBytes)
            challenge = ByteArray(16).also(random::nextBytes)
            val aad = "hichain_iso_exchange".toByteArray(StandardCharsets.UTF_8)
            val encData = CryptoUtils.encryptAES_GCM_NoPad(challenge, sessionKey, nonce, aad)
            packet = current.StepThree(params, messageId, nonce, encData)
          } else {
            // operationCode 2 has no step 3 message: GB skips straight to the step-4 payload while
            // keeping messageId = 3.
            step += 0x01
          }
        }
        if (step == 0x04) {
          val nonce = ByteArray(12).also(random::nextBytes)
          val input = byteArrayOf(0x00, 0x00, 0x00, 0x00)
          val aad = "hichain_iso_result".toByteArray(StandardCharsets.UTF_8)
          val encResult = CryptoUtils.encryptAES_GCM_NoPad(input, sessionKey, nonce, aad)
          packet = current.StepFour(params, messageId, nonce, encResult)
        }
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        throw WearException(ErrorCodes.PROTOCOL, "$label: HiChain exception: ${e.message ?: e.javaClass.simpleName}", e)
      }
      val outgoing = packet ?: throw WearException(ErrorCodes.PROTOCOL, "$label: no HiChain message for step $step")

      val response = try {
        session
          .request(outgoing, if (step == 0x01) firstStepTimeout else stepTimeout, label)
          .expect<HiChain.Response>(label)
      } catch (e: WearException) {
        val hint = if (pairing && step == 0x01 && e.errorCode == ErrorCodes.TIMEOUT) FirstBind.leStepOneTimeoutHint(deviceType, androidSdk) else null
        throw if (hint != null) WearException(e.errorCode, "${e.message}. $hint", e, e.statusCode) else e
      }

      // GetHiChainRequest.processResponse
      if (response.errorCode != 0) {
        throw WearException(ErrorCodes.PROTOCOL, "$label: Got errorCode ${response.errorCode}")
      }
      step = response.step.toInt()
      if (step !in 0x01..0x04) {
        // GB would silently increment and resend a step-1 message here.
        throw WearException(ErrorCodes.PROTOCOL, "$label: unexpected HiChain response step $step")
      }

      try {
        if (step == 0x04) {
          if (pairing) {
            events.log(LogDirection.INFO, null, null, null, "HiChain: auth operation finished, going to bind")
          } else {
            events.log(LogDirection.INFO, null, null, null, "HiChain: bind operation finished")
            val salt = ByteBuffer
              .allocate(randSelf.size + randPeer.size)
              .put(randSelf)
              .put(randPeer)
              .array()
            val info = "hichain_return_key".toByteArray(StandardCharsets.UTF_8)
            val key = CryptoUtils.hkdfSha256(sessionKey, salt, info, 32)
            params.setSecretKey(key)
          }
          return
        }

        if (step == 0x01) {
          authIdSelf = identity.androidIdBytes
          authIdPeer = response.step1Data.peerAuthId
          randPeer = response.step1Data.isoSalt
          val peerToken = response.step1Data.token
          // GeneratePsk
          val key: ByteArray = if (operationCode == 0x01) {
            val pinCodeHexStr = StringUtils.bytesToHex(params.pinCode)
            CryptoUtils.digest(pinCodeHexStr.toByteArray(StandardCharsets.UTF_8))
          } else {
            identity.authKey ?: throw WearException(ErrorCodes.PROTOCOL, "no stored auth key")
          }
          psk = CryptoUtils.calcHmacSha256(key, seed)
          val message = ByteBuffer
            .allocate(randPeer.size + randSelf.size + authIdSelf.size + authIdPeer.size)
            .put(randPeer)
            .put(randSelf)
            .put(authIdSelf)
            .put(authIdPeer)
            .array()
          val tokenCheck = CryptoUtils.calcHmacSha256(psk, message)
          if (!peerToken.contentEquals(tokenCheck)) {
            throw WearException(
              ErrorCodes.PROTOCOL,
              "tokenCheck: ${tokenCheck.toHex()} is different than ${peerToken.toHex()}",
            )
          }
          lab?.trace(
            events,
            "op$operationCode step 1 verified: peerAuthId=${authIdPeer.toHex()} (${String(authIdPeer, StandardCharsets.UTF_8)}) " +
              "isoSalt=${randPeer.toHex()} token=${peerToken.toHex()} psk=${psk.toHex()}",
          )
        } else if (step == 0x02) {
          val returnCodeMac = response.step2Data.returnCodeMac
          val returnCodeMacCheck = CryptoUtils.calcHmacSha256(psk, byteArrayOf(0x00, 0x00, 0x00, 0x00))
          if (!returnCodeMacCheck.contentEquals(returnCodeMac)) {
            throw WearException(
              ErrorCodes.PROTOCOL,
              "returnCodeMacCheck: ${returnCodeMacCheck.toHex()} is different than ${returnCodeMac.toHex()}",
            )
          }
          if (pairing) lab?.reached(BindStop.ISO_MAC_VERIFIED)
        } else if (step == 0x03) {
          if (operationCode == 0x01) {
            val nonce = response.step3Data.nonce
            val encAuthToken = response.step3Data.encAuthToken
            val authToken = CryptoUtils.decryptAES_GCM_NoPad(encAuthToken, sessionKey, nonce, challenge)
            identity.authKey = authToken
            params.setSecretKey(authToken)
          }
        }
        step += 0x01
      } catch (e: WearException) {
        throw WearException(e.errorCode, "$label: ${e.message}", e)
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        throw WearException(ErrorCodes.PROTOCOL, "$label: ${e.message ?: e.javaClass.simpleName}", e)
      }
    }
  }

  // initializeDeviceHiChainLiteMode

  private suspend fun hiChainLiteMode(serverNonce: ByteArray, authTimeout: Long) {
    params.setSecretKey(identity.createSecretKey())
    val auth = AuthExchange(serverNonce)
    if (params.pinCode == null && params.authVersion.toInt() != 0x02) {
      pinCode(authTimeout)
    }
    auth.run(authTimeout)
    bondParamsAndBond(authTimeout)
  }

  /** GetBondParamsRequest, then GetBondRequest: how GB finishes HiChain Lite on every transport, and normal mode on LE. */
  private suspend fun bondParamsAndBond(authTimeout: Long) {
    // GetBondParamsRequest
    val bondParams = session
      .request(
        DeviceConfig.BondParams.Request(params, identity.serialBytes, identity.macAddressBytes),
        authTimeout,
        "BondParams",
      )
      .expect<DeviceConfig.BondParams.Response>("BondParams")
    params.setEncryptionCounter(bondParams.encryptionCounter)
    if (params.authMode.toInt() != 0x02 && bondParams.status.toInt() == 1) {
      // stopChain(this): the Bond request is skipped.
      identity.markBonded()
      return
    }

    // GetBondRequest
    val iv = params.iv
    val crypto = HuaweiCrypto(
      params.authVersion.toInt(),
      params.authAlgo,
      params.deviceSupportType.toInt(),
      params.authMode,
    )
    val encryptionKey: ByteArray = if (params.authMode.toInt() == 0x02) {
      params.firstKey
    } else {
      crypto.createSecretKey(identity.deviceAddress)
    }
    val key = crypto.encryptBondingKey(params.encryptMethod, params.secretKey, encryptionKey, iv)
    session.request(
      DeviceConfig.Bond.Request(params, identity.serialBytes, key, iv),
      authTimeout,
      "Bond",
    )
    identity.markBonded()
  }

  // initializeDeviceNormalMode: BR is Auth only; BLE and AW go on with BondParams and Bond, like HiChain Lite.

  private suspend fun normalMode(serverNonce: ByteArray, authTimeout: Long) {
    params.setSecretKey(identity.createSecretKey())
    AuthExchange(serverNonce).run(authTimeout)
    if (deviceType == HuaweiDeviceType.BLE || deviceType == HuaweiDeviceType.AW) {
      bondParamsAndBond(authTimeout)
    } else {
      identity.markBonded()
    }
  }

  /** GetAuthRequest: the constructor captures params at construction time, like GB's. */
  private inner class AuthExchange(serverNonce: ByteArray) {
    private val clientNonce: ByteArray = HuaweiCrypto.generateNonce()
    private val doubleNonce: ByteArray = ByteBuffer.allocate(32)
      .put(serverNonce)
      .put(clientNonce)
      .array()
    private val authVersion: Short = params.authVersion.toShort()
    private val authMode: Byte = params.authMode
    private val crypto = HuaweiCrypto(
      authVersion.toInt(),
      params.authAlgo,
      params.deviceSupportType.toInt(),
      authMode,
    )
    private var key: ByteArray? = null

    suspend fun run(timeoutMs: Long) {
      // createRequest
      if (authMode.toInt() == 0x02) {
        key = params.pinCode
        if (authVersion.toInt() == 0x02) key = params.secretKey
      }
      val nonce = ByteBuffer.allocate(18)
        .putShort(authVersion)
        .put(clientNonce)
        .array()
      val digestedChallenge = ByteBuffer.wrap(crypto.digestChallenge(key, doubleNonce))
      val challenge = ByteArray(0x20)
      digestedChallenge.get(challenge, 0x00, 0x20)
      // Reads on from where `challenge` ended, exactly as GB does.
      val firstKey = ByteArray(0x10)
      digestedChallenge.get(firstKey, 0x00, 0x10)
      params.setFirstKey(firstKey)

      val response = session
        .request(DeviceConfig.Auth.Request(params, challenge, nonce), timeoutMs, "Auth")
        .expect<DeviceConfig.Auth.Response>("Auth")

      // processResponse
      val digestedResponse = ByteBuffer.wrap(crypto.digestResponse(key, doubleNonce))
      val expectedAnswer = ByteArray(0x20)
      digestedResponse.get(expectedAnswer, 0x00, 0x20)
      val actualAnswer: ByteArray = response.challengeResponse
      if (!expectedAnswer.contentEquals(actualAnswer)) {
        throw WearException(
          ErrorCodes.PROTOCOL,
          "Challenge answer mismatch : ${actualAnswer.toHex()} != ${expectedAnswer.toHex()}",
        )
      }
    }
  }
}

/** GB `ResponseTypeMismatchException`. */
internal inline fun <reified T : HuaweiPacket> HuaweiPacket.expect(label: String): T =
  this as? T ?: throw WearException(
    ErrorCodes.PROTOCOL,
    "$label: response type mismatch, packet is of type ${javaClass.name} but expected ${T::class.java.name}",
  )
