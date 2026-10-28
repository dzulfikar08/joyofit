// Port of HuaweiAuthenticator.kt (Gadgetbridge HuaweiSupportProvider.initializeDevice* and the Get{LinkParams,DeviceStatus,
// SecurityNegotiation,Pincode,HiChain,Auth,BondParams,Bond}Request chain): LinkParams, DeviceStatus, SecurityNegotiation, then HiChain
// (version 1 and 3), HiChain Lite or the normal mode. Developer bind-lab hooks of the Kotlin class are not ported.
import Foundation

/// The phase timeouts of one link, in milliseconds. The defaults are the Kotlin `Timeouts`; tests shorten them.
struct LinkTimeouts {
    var authMs = Timeouts.authMs
    /// SecurityNegotiation, PinCode and HiChain operationCode 1 of a first bind. Kotlin waits 30 s (`Timeouts.FIRST_AUTH_MS`); on iOS the
    /// user confirms on the watch (and may answer the system pairing dialog), so the wait is 120 s. The operationCode 2 steps keep the
    /// Kotlin reconnect values below.
    var firstAuthMs = 120_000
    var hichainFirstStepMs = Timeouts.hichainAuthFirstStepMs
    var hichainStepMs = Timeouts.hichainAuthStepMs
    var initMs = Timeouts.initMs
    var queryMs = Timeouts.queryMs
    var syncCountMs = Timeouts.syncCountMs
    var syncDataMs = Timeouts.syncDataMs
    /// GB: "The watch never answers to this command" (SetUpDeviceStatus), so this wait is short.
    var setupStatusMs = 300
    /// LinkParams is a query that changes nothing on the watch, so a watch that says nothing is asked again: up to `linkParamsAttempts`
    /// times, the first wait being `authMs`, the later ones `linkParamsRetryMs`. After a silence the authenticator is quiet for
    /// `linkParamsBackoffMs` times the number of the attempt that just failed (1 s, then 2 s), then runs `LinkRecovery`, then asks again.
    var linkParamsAttempts = 3
    var linkParamsRetryMs = 8_000
    var linkParamsBackoffMs = 1_000
}

/// What the authenticator asks of the transport before a LinkParams retry (`attempt` is 2 or 3, the one about to start): do something to the
/// link that the earlier attempts did not. Returns a line saying what was done, for the log; nil when there is nothing different to try.
/// Throws `.disconnected` (or the Bluetooth errors) only when the link itself is gone; any other error is logged and the attempt still runs.
public typealias LinkRecovery = @Sendable (_ attempt: Int) async throws -> String?

/// Why `authenticate(firstBindAllowed: false)` stopped: the watch needs a first bind (it does not know this phone, or this phone holds no key).
/// Carried as the `underlying` error of the ERR_AUTH_FAILED `WearError`.
public struct FirstBindNeededError: Error, Equatable, CustomStringConvertible {
    /// The SecurityNegotiation authType: 5 when the watch does not know this phone, 6 when it does but no key is stored here.
    public let authType: Int
    /// True when the watch does not know this phone although a bind key is stored here: something else bound the watch since. On
    /// 2026-10-25 that was twice Huawei Health on the same phone, re-binding by itself after JoyoFit's link ended (JRG-414).
    public let lostBinding: Bool

    public init(authType: Int, lostBinding: Bool = false) {
        self.authType = authType
        self.lostBinding = lostBinding
    }

    public var description: String {
        authType == 5 ? "watch does not know this phone: first bind needed" : "no bind key is stored for this watch: first bind needed"
    }
}

/// The ERR_BIND_CONFIRMATION texts; `lost` is Kotlin's `FirstBind.LOST_MESSAGE` without the watch brand (the iOS app names none,
/// App Store guideline 4.1(b)). JS (`connectFailure.ts`) tells a lost binding by `marker`, which both keep word for word.
public enum FirstBindMessage {
    public static let marker = "no longer knows this phone's pairing"
    public static let lost =
        "This watch no longer knows this phone's pairing: another app or phone paired it again while JoyoFit was not connected " +
        "(for example the watch's own app, which does that by itself while it is enabled). Pairing again replaces that pairing."
    public static let notBound =
        "This watch has to be paired with this phone first. Pairing replaces the watch's current phone pairing (another phone or app)."

    /// The background service's note for a stop before a first bind.
    public static func backgroundNote(lostBinding: Bool) -> String {
        lostBinding
            ? "Paired again by another app or phone (for example the watch's own app). Stop it from connecting to the watch, then pair from the app."
            : "The watch does not know this phone. Connect from the app to bind it."
    }
}

extension WearError {
    /// True for the ERR_AUTH_FAILED of `authenticate(firstBindAllowed: false)` that only a user-started bind can resolve.
    public var isFirstBindNeeded: Bool { underlying is FirstBindNeededError }
    /// True when that stop is for a binding the watch forgot (`FirstBindNeededError.lostBinding`).
    public var isLostBinding: Bool { (underlying as? FirstBindNeededError)?.lostBinding == true }
}

public final class HuaweiAuthenticator {
    private let session: HuaweiSession
    private let identity: DeviceIdentity
    private let log: LogSink
    private let deviceType: HuaweiDeviceType
    private let phoneModel: String

    /// Replaced by tests: the phase timeouts and the clock that stamps a HiChain request.
    var timeouts = LinkTimeouts()
    var clock: () -> Date = { Date() }

    /// Set by the link that owns the transport: what to change about the link between two LinkParams attempts. Nil: attempts only repeat.
    public var linkRecovery: LinkRecovery?

    /// HuaweiConstants.GROUP_ID.
    private static let hiChainGroupId = "7B0BC0CBCE474F6C238D9661C63400B797B166EA7849B3A370FC73A9A236E989"

    private var params: ParamsProvider { session.params }

    /// LinkParams protocolVersion (GB `HuaweiSupportProvider.getProtocolVersion()`); valid after `authenticate()`.
    public private(set) var protocolVersion: Int = 0

    /// - Parameter phoneModel: what Android reports as `Build.MODEL`; the watch is told it in the SecurityNegotiation (authMode 4).
    public init(
        session: HuaweiSession, identity: DeviceIdentity, log: @escaping LogSink,
        deviceType: HuaweiDeviceType = .ble, phoneModel: String
    ) {
        self.session = session
        self.identity = identity
        self.log = log
        self.deviceType = deviceType
        self.phoneModel = phoneModel
    }

    /// Runs the whole authentication. Throws `WearError`: ERR_AUTH_FAILED (GB-style reason in the message), ERR_TIMEOUT, ERR_DEVICE_STATUS or
    /// ERR_DISCONNECTED.
    ///
    /// - Parameter firstBindAllowed: whether this connection may start a first bind (PinCode, HiChain operationCode 1). Binding replaces
    ///   the watch's one stored credential (an Android phone's, say), so a reconnect running in the background passes `false`: when the
    ///   watch does not know this phone (authType 5), or this phone has no stored key, the authentication ends with ERR_AUTH_FAILED
    ///   "watch does not know this phone: first bind needed" before any PinCode request is sent, and the error's `underlying` is a
    ///   `FirstBindNeededError` (ERR_AUTH_FAILED is also the code of every other authentication failure, a wrong token say).
    public func authenticate(firstBindAllowed: Bool = true) async throws -> AuthMode {
        do {
            return try await negotiate(firstBindAllowed: firstBindAllowed)
        } catch let e as WearError {
            switch e.code {
            case .protocolError: throw WearError(.authFailed, "Authentication failed: \(e.message)", underlying: e)
            case .timeout: throw WearError(.timeout, "Authentication timed out: \(e.message)", underlying: e)
            default: throw e
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw WearError(.authFailed, "Authentication failed: \(error)", underlying: error)
        }
    }

    private func info(_ message: String) {
        log(LogEntry(.info, message))
    }

    private func negotiate(firstBindAllowed: Bool) async throws -> AuthMode {
        var firstConnection = identity.isFirstConnection
        var authTimeout = firstConnection ? timeouts.firstAuthMs : timeouts.authMs

        // GB initializeDevice(): fake MAC / android id are created before the first request.
        identity.ensureCreated()

        let serverNonce = try await linkParams()

        // GB initializeDeviceCheckStatus (askStatus = true). GB skips it for HuaweiDeviceType.BLE ("only BLE known, check later for
        // AW and SMART") and goes straight to the security negotiation.
        if deviceType != .ble {
            let status = try await deviceStatus()
            if status != -1 && status != 0 && status != 1 {
                // GB calls initializeDeviceNotify(), an empty TODO, so the connection silently hangs.
                throw WearError(
                    .deviceStatus,
                    "Watch reported unexpected device status \(status) (\(UInt8(bitPattern: Int8(status)).hex2)); expected -1, 0 or 1"
                )
            }
        }

        // GB initializeDeviceDealHiChain.
        if !isHiChain() {
            info("Auth: normal mode")
            try await normalMode(serverNonce: serverNonce, authTimeout: authTimeout)
            return .normal
        }

        params.authMode = params.deviceSupportType == 4 ? 4 : 2
        let authType = try await securityNegotiation(timeoutMs: authTimeout)

        let mode: AuthMode
        if authType == 0x0186A0 || isHiChain3(authType) {
            mode = (params.deviceSupportType == 4 || isHiChain3(authType)) ? .hichain3 : .hichain
            // Real-hardware evidence (Fit 4 Pro over LE, authMode 4): the SecurityNegotiation answer tells whether the watch knows our
            // authId, tag 0x02 = 2 gives authType 6 (known) and 1 gives authType 5 (new). Kotlin trusts the local bond flag alone;
            // here a stored key the watch does not recognise starts a first bind (PIN, op 1, op 2) instead of failing in op 2.
            var lostBinding = false
            if params.authMode == 4 && authType == 5 && !firstConnection {
                info("Auth: the watch does not know this identity (authType 5) although a bind key is stored locally: running the first-bind path (PinCode, HiChain op 1, op 2)")
                firstConnection = true
                lostBinding = true
                authTimeout = timeouts.firstAuthMs
            } else if params.authMode == 4 && authType == 6 && firstConnection {
                info("Auth: the watch already knows this identity (authType 6) but no bind is stored locally: following the local state (first-bind path)")
            } else if params.authMode == 4 {
                info("Auth: the watch and the local state agree (authType \(authType), firstConnection=\(firstConnection))")
            }
            info("Auth: \(mode.rawValue) mode (authType=\(authType), firstConnection=\(firstConnection))")
            if firstConnection && !firstBindAllowed {
                // Decided before the PinCode request: nothing on the watch changes.
                let message = authType == 5
                    ? "watch does not know this phone: first bind needed"
                    : "no bind key is stored for this watch: first bind needed"
                info("Auth: \(message) (authType=\(authType)); this connection may not start a first bind")
                throw WearError(.authFailed, message, underlying: FirstBindNeededError(authType: authType, lostBinding: lostBinding))
            }
            try await hiChainMode(firstConnection: firstConnection, authTimeout: authTimeout)
        } else if authType == 0x01 || authType == 0x02 {
            mode = .hichainLite
            info("Auth: hichain-lite mode (authType=\(authType))")
            try await hiChainLiteMode(serverNonce: serverNonce, authTimeout: authTimeout)
        } else {
            // GB falls through finalizeSecurityNegotiationHiChain without doing anything.
            throw WearError(.protocolError, "Unsupported security negotiation authType \(authType)")
        }
        return mode
    }

    // MARK: GetLinkParamsRequest

    /// Asks the watch for its link parameters. Over Bluetooth LE a watch that is connected and has notifications on can still say nothing
    /// (another central owns its session, a stale GATT table, a write it dropped), so after a silence the request is repeated, and
    /// `linkRecovery` is given the quiet in between to change something about the link. The error of the last silence keeps the "LinkParams:
    /// no response" text, so what the person sees names the same step as before.
    private func linkParams() async throws -> Bytes {
        let response = try await requestLinkParams()
        params.deviceSupportType = UInt8(bitPattern: response.deviceSupportType)
        params.sliceSize = Int(response.sliceSize) // Kotlin Short.toInt(): signed
        params.mtu = Int(response.mtu)
        params.authVersion = UInt8(bitPattern: response.authVersion)
        params.authAlgo = UInt8(bitPattern: response.authAlgo)
        params.encryptMethod = UInt8(bitPattern: response.encryptMethod)
        protocolVersion = Int(UInt8(bitPattern: response.protocolVersion))
        info(
            "LinkParams: protocolVersion=\(UInt8(bitPattern: response.protocolVersion).hex2) deviceSupportType=\(UInt8(bitPattern: response.deviceSupportType).hex2) "
                + "authVersion=\(UInt8(bitPattern: response.authVersion).hex2) authAlgo=\(UInt8(bitPattern: response.authAlgo).hex2) "
                + "encryptMethod=\(UInt8(bitPattern: response.encryptMethod).hex2) bondState=\(UInt8(bitPattern: response.bondState).hex2) "
                + "mtu=\(response.mtu) sliceSize=\(response.sliceSize)"
        )
        return response.serverNonce
    }

    private func requestLinkParams() async throws -> DeviceConfig.LinkParams.Response {
        let attempts = max(timeouts.linkParamsAttempts, 1)
        var attempt = 1
        while true {
            let waitMs = attempt == 1 ? timeouts.authMs : timeouts.linkParamsRetryMs
            do {
                let response = try await session.request(
                    DeviceConfig.LinkParams.request(deviceType: deviceType), as: DeviceConfig.LinkParams.Response.self,
                    timeoutMs: waitMs, label: "LinkParams"
                )
                if attempt > 1 { info("LinkParams: answered on attempt \(attempt) of \(attempts)") }
                return response
            } catch let silence as WearError where silence.code == .timeout {
                guard attempt < attempts else {
                    throw WearError(.timeout, "\(silence.message) (\(attempt) \(attempt == 1 ? "attempt" : "attempts"))", underlying: silence)
                }
                let quietMs = timeouts.linkParamsBackoffMs * attempt
                info("LinkParams: no answer within \(waitMs) ms (attempt \(attempt) of \(attempts)); trying again in \(quietMs) ms")
                try await Task.sleep(nanoseconds: UInt64(max(quietMs, 0)) * 1_000_000)
                attempt += 1
                try await recoverLink(beforeAttempt: attempt)
            }
        }
    }

    /// Lets the transport change something about the link before LinkParams attempt `attempt`. A failed recovery is logged and the attempt
    /// still runs (it ends in the same silence or in the link error); only a link that is gone or a cancelled connect stops here.
    private func recoverLink(beforeAttempt attempt: Int) async throws {
        guard let linkRecovery else { return }
        do {
            if let done = try await linkRecovery(attempt) { info("LinkParams: before attempt \(attempt): \(done)") }
        } catch is CancellationError {
            throw CancellationError()
        } catch let e as WearError where e.code == .disconnected || e.code == .bluetoothOff || e.code == .bluetoothPermission {
            throw e
        } catch {
            info("LinkParams: before attempt \(attempt): the link could not be changed (\(error)); asking anyway")
        }
    }

    // MARK: GetDeviceStatusRequest

    private func deviceStatus() async throws -> Int {
        let response = try await session.request(
            DeviceConfig.DeviceStatus.request(askStatus: true), as: DeviceConfig.DeviceStatus.Response.self,
            timeoutMs: timeouts.authMs, label: "DeviceStatus"
        )
        return Int(response.status)
    }

    // MARK: HuaweiSupportProvider.isHiChain / isHiChainLite / isHiChain3

    private func isHiChain() -> Bool {
        let type = Int(Int8(bitPattern: params.deviceSupportType))
        return type == 0x01 || type == 0x03 || type == 0x04 || isHiChainLite()
    }

    private func isHiChainLite() -> Bool { Int(Int8(bitPattern: params.deviceSupportType)) == 0x02 }

    private func isHiChain3(_ authType: Int) -> Bool { (authType ^ 0x01) == 0x04 || (authType ^ 0x02) == 0x04 }

    // MARK: GetSecurityNegotiationRequest (non-Honor variant)

    private func securityNegotiation(timeoutMs: Int) async throws -> Int {
        let request = DeviceConfig.SecurityNegotiation.request(
            params: params, authMode: params.authMode, deviceUUID: identity.androidIdBytes, phoneModel: phoneModel
        )
        let response = try await session.request(request, as: DeviceConfig.SecurityNegotiation.Response.self, timeoutMs: timeoutMs, label: "SecurityNegotiation")
        return response.authType
    }

    // MARK: GetPincodeRequest

    private func pinCode(timeoutMs: Int) async throws {
        let packet = try await session.request(DeviceConfig.PinCode.request(), timeoutMs: timeoutMs, label: "PinCode")
        let response: DeviceConfig.PinCode.Response
        do {
            response = try DeviceConfig.PinCode.Response(packet: packet, params: params)
        } catch let e as WearError {
            throw e
        } catch {
            throw WearError(.protocolError, "PinCode: failed to parse response: \(error)", underlying: error, isParseFailure: true)
        }
        params.pinCode = response.pinCode
    }

    // MARK: initializeDeviceHiChainMode

    private func hiChainMode(firstConnection: Bool, authTimeout: Int) async throws {
        if firstConnection {
            try await pinCode(timeoutMs: authTimeout)
            // operationCode 1 (GB logs it as the "auth operation": PIN-derived key, the user confirms on the watch, stores the auth
            // token), then operationCode 2 (GB's "bind operation").
            try await hiChain(operationCode: 0x01)
        }
        try await hiChain(operationCode: 0x02)
        identity.markBonded()
    }

    /// GetHiChainRequest: one four-step ISO exchange. `operationCode` 1 = first-time pairing (PIN-derived key, stores the auth token),
    /// 2 = authentication with the stored auth key, which derives the session key. The request chain `step += 1` after each response is
    /// the loop below.
    private func hiChain(operationCode: Int) async throws {
        let pairing = operationCode == 0x01
        let firstStepTimeout = pairing ? timeouts.firstAuthMs : timeouts.hichainFirstStepMs
        let stepTimeout = pairing ? timeouts.firstAuthMs : timeouts.hichainStepMs

        var step = 0x01
        var requestId: Int64 = 0x00
        var chain: DeviceConfig.HiChain.Request?
        var authIdSelf = Bytes()
        var authIdPeer = Bytes()
        var randSelf = Bytes()
        var randPeer = Bytes()
        var seed = Bytes()
        var challenge = Bytes()
        var psk = Bytes()
        var sessionKey = Bytes()

        while true {
            // GetHiChainRequest.createRequest
            if requestId == 0x00 { requestId = Int64((clock().timeIntervalSince1970 * 1000).rounded(.down)) }
            let label = "HiChain op\(operationCode) step \(step)"
            let current = chain ?? DeviceConfig.HiChain.Request(
                operationCode: operationCode, requestId: requestId, selfAuthId: identity.androidIdBytes, groupId: HuaweiAuthenticator.hiChainGroupId
            )
            chain = current

            let messageId = step
            var packet: HuaweiPacket?
            do {
                if step == 0x01 {
                    seed = Entropy.bytes(32)
                    randSelf = Entropy.bytes(16)
                    packet = current.stepOne(messageId: messageId, isoSalt: randSelf, seed: seed)
                } else if step == 0x02 {
                    let message = randSelf + randPeer + authIdPeer + authIdSelf
                    let selfToken = HMACSHA256.mac(key: psk, message: message)
                    packet = current.stepTwo(messageId: messageId, token: selfToken)
                } else if step == 0x03 {
                    let salt = randSelf + randPeer
                    let keyInfo = Array("hichain_iso_session_key".utf8)
                    sessionKey = HKDFSHA256.derive(secretKey: psk, salt: salt, info: keyInfo, outputLength: 32)
                    if operationCode == 0x01 {
                        let nonce = Entropy.bytes(12)
                        challenge = Entropy.bytes(16)
                        let aad = Array("hichain_iso_exchange".utf8)
                        let encData = try AES.encryptGCM(challenge, key: sessionKey, iv: nonce, aad: aad)
                        packet = current.stepThree(messageId: messageId, nonce: nonce, encData: encData)
                    } else {
                        // operationCode 2 has no step 3 message: GB skips straight to the step-4 payload while keeping messageId = 3.
                        step += 0x01
                    }
                }
                if step == 0x04 {
                    let nonce = Entropy.bytes(12)
                    let input: Bytes = [0x00, 0x00, 0x00, 0x00]
                    let aad = Array("hichain_iso_result".utf8)
                    let encResult = try AES.encryptGCM(input, key: sessionKey, iv: nonce, aad: aad)
                    packet = current.stepFour(messageId: messageId, nonce: nonce, encResult: encResult)
                }
            } catch {
                throw WearError(.protocolError, "\(label): HiChain exception: \(error)", underlying: error)
            }
            guard let outgoing = packet else { throw WearError(.protocolError, "\(label): no HiChain message for step \(step)") }

            let response = try await session.request(
                outgoing, as: DeviceConfig.HiChain.Response.self, timeoutMs: step == 0x01 ? firstStepTimeout : stepTimeout, label: label
            )

            // GetHiChainRequest.processResponse
            if response.errorCode != 0 {
                throw WearError(.protocolError, "\(label): Got errorCode \(response.errorCode)")
            }
            step = Int(response.step)
            if !(0x01...0x04).contains(step) {
                // GB would silently increment and resend a step-1 message here.
                throw WearError(.protocolError, "\(label): unexpected HiChain response step \(step)")
            }

            do {
                if step == 0x04 {
                    if pairing {
                        info("HiChain: auth operation finished, going to bind")
                    } else {
                        info("HiChain: bind operation finished")
                        let salt = randSelf + randPeer
                        let keyInfo = Array("hichain_return_key".utf8)
                        params.secretKey = HKDFSHA256.derive(secretKey: sessionKey, salt: salt, info: keyInfo, outputLength: 32)
                    }
                    return
                }

                if step == 0x01 {
                    guard let step1 = response.step1Data else { throw WearError(.protocolError, "missing step 1 data") }
                    authIdSelf = identity.androidIdBytes
                    authIdPeer = step1.peerAuthId
                    randPeer = step1.isoSalt
                    let peerToken = step1.token
                    // GeneratePsk
                    let key: Bytes
                    if operationCode == 0x01 {
                        guard let pin = params.pinCode else { throw WearError(.protocolError, "no PIN code") }
                        key = SHA256.hash(Array(pin.hexUpper.utf8))
                    } else {
                        guard let stored = identity.authKey else { throw WearError(.protocolError, "no stored auth key") }
                        key = stored
                    }
                    psk = HMACSHA256.mac(key: key, message: seed)
                    let message = randPeer + randSelf + authIdSelf + authIdPeer
                    let tokenCheck = HMACSHA256.mac(key: psk, message: message)
                    if peerToken != tokenCheck {
                        throw WearError(.protocolError, "tokenCheck: \(tokenCheck.hexUpper) is different than \(peerToken.hexUpper)")
                    }
                } else if step == 0x02 {
                    guard let step2 = response.step2Data else { throw WearError(.protocolError, "missing step 2 data") }
                    let returnCodeMacCheck = HMACSHA256.mac(key: psk, message: [0x00, 0x00, 0x00, 0x00])
                    if returnCodeMacCheck != step2.returnCodeMac {
                        throw WearError(
                            .protocolError,
                            "returnCodeMacCheck: \(returnCodeMacCheck.hexUpper) is different than \(step2.returnCodeMac.hexUpper)"
                        )
                    }
                } else if step == 0x03 {
                    if operationCode == 0x01 {
                        guard let step3 = response.step3Data else { throw WearError(.protocolError, "missing step 3 data") }
                        let authToken = try AES.decryptGCM(step3.encAuthToken, key: sessionKey, iv: step3.nonce, aad: challenge)
                        identity.authKey = authToken
                        params.secretKey = authToken
                    }
                }
                step += 0x01
            } catch let e as WearError {
                throw WearError(e.code, "\(label): \(e.message)", underlying: e)
            } catch {
                throw WearError(.protocolError, "\(label): \(error)", underlying: error)
            }
        }
    }

    // MARK: initializeDeviceHiChainLiteMode

    private func hiChainLiteMode(serverNonce: Bytes, authTimeout: Int) async throws {
        params.secretKey = identity.createSecretKey()
        let auth = AuthExchange(serverNonce: serverNonce, params: params)
        if params.pinCode == nil && params.authVersion != 0x02 {
            try await pinCode(timeoutMs: authTimeout)
        }
        try await auth.run(session: session, timeoutMs: authTimeout)
        try await bondParamsAndBond(authTimeout: authTimeout)
    }

    /// GetBondParamsRequest, then GetBondRequest: how GB finishes HiChain Lite on every transport, and normal mode on LE.
    private func bondParamsAndBond(authTimeout: Int) async throws {
        // GetBondParamsRequest
        let bondParams = try await session.request(
            DeviceConfig.BondParams.request(clientSerial: identity.serialBytes, mac: identity.macAddressBytes),
            as: DeviceConfig.BondParams.Response.self, timeoutMs: authTimeout, label: "BondParams"
        )
        params.encryptionCounter = bondParams.encryptionCounter
        if params.authMode != 0x02 && bondParams.status == 1 {
            // stopChain(this): the Bond request is skipped.
            identity.markBonded()
            return
        }

        // GetBondRequest
        let iv = params.nextIV()
        let crypto = HuaweiCrypto(
            authVersion: Int(Int8(bitPattern: params.authVersion)), authAlgo: params.authAlgo,
            deviceSupportType: Int(Int8(bitPattern: params.deviceSupportType)), authMode: params.authMode
        )
        let encryptionKey: Bytes
        if params.authMode == 0x02 {
            guard let first = params.firstKey else { throw WearError(.protocolError, "Bond: no first key") }
            encryptionKey = first
        } else {
            encryptionKey = crypto.createSecretKey(macAddress: identity.deviceAddress)
        }
        guard let secretKey = params.secretKey else { throw WearError(.protocolError, "Bond: no secret key") }
        let key: Bytes
        do {
            key = try crypto.encryptBondingKey(encryptMethod: params.encryptMethod, data: secretKey, key: encryptionKey, iv: iv)
        } catch {
            throw WearError(.protocolError, "Bond: could not encrypt the bonding key: \(error)", underlying: error)
        }
        _ = try await session.request(
            DeviceConfig.Bond.request(clientSerial: identity.serialBytes, key: key, iv: iv), timeoutMs: authTimeout, label: "Bond"
        )
        identity.markBonded()
    }

    // MARK: initializeDeviceNormalMode

    /// BR is Auth only; BLE and AW go on with BondParams and Bond, like HiChain Lite.
    private func normalMode(serverNonce: Bytes, authTimeout: Int) async throws {
        params.secretKey = identity.createSecretKey()
        try await AuthExchange(serverNonce: serverNonce, params: params).run(session: session, timeoutMs: authTimeout)
        if deviceType == .ble || deviceType == .aw {
            try await bondParamsAndBond(authTimeout: authTimeout)
        } else {
            identity.markBonded()
        }
    }

    /// GetAuthRequest: the constructor captures params at construction time, like GB's.
    private struct AuthExchange {
        let params: ParamsProvider
        let clientNonce: Bytes
        let doubleNonce: Bytes
        /// A Java `short` read from the signed byte.
        let authVersion: Int16
        let authMode: UInt8
        let crypto: HuaweiCrypto

        init(serverNonce: Bytes, params: ParamsProvider) {
            self.params = params
            clientNonce = HuaweiCrypto.generateNonce()
            doubleNonce = serverNonce + clientNonce
            authVersion = Int16(Int8(bitPattern: params.authVersion))
            authMode = params.authMode
            crypto = HuaweiCrypto(
                authVersion: Int(authVersion), authAlgo: params.authAlgo,
                deviceSupportType: Int(Int8(bitPattern: params.deviceSupportType)), authMode: authMode
            )
        }

        func run(session: HuaweiSession, timeoutMs: Int) async throws {
            // createRequest
            var key: Bytes?
            if authMode == 0x02 {
                key = params.pinCode
                if authVersion == 0x02 { key = params.secretKey }
            }
            var nonce = Bytes()
            nonce.appendBE(UInt16(bitPattern: authVersion))
            nonce += clientNonce
            let digestedChallenge: Bytes?
            do {
                digestedChallenge = try crypto.digestChallenge(secretKey: key, nonce: doubleNonce)
            } catch {
                throw WearError(.protocolError, "Auth: could not digest the challenge: \(error)", underlying: error)
            }
            guard let digest = digestedChallenge, digest.count >= 0x30 else {
                throw WearError(.protocolError, "Auth: no challenge digest (HiChain Lite without a key)")
            }
            let challenge = Array(digest[0..<0x20])
            // Reads on from where `challenge` ended, exactly as GB does.
            params.firstKey = Array(digest[0x20..<0x30])

            let response = try await session.request(
                DeviceConfig.Auth.request(params: params, challenge: challenge, nonce: nonce), as: DeviceConfig.Auth.Response.self,
                timeoutMs: timeoutMs, label: "Auth"
            )

            // processResponse
            let digestedResponse: Bytes?
            do {
                digestedResponse = try crypto.digestResponse(secretKey: key, nonce: doubleNonce)
            } catch {
                throw WearError(.protocolError, "Auth: could not digest the response: \(error)", underlying: error)
            }
            guard let expected = digestedResponse, expected.count >= 0x20 else {
                throw WearError(.protocolError, "Auth: no response digest")
            }
            let expectedAnswer = Array(expected[0..<0x20])
            if expectedAnswer != response.challengeResponse {
                throw WearError(.protocolError, "Challenge answer mismatch : \(response.challengeResponse.hexUpper) != \(expectedAnswer.hexUpper)")
            }
        }
    }
}
