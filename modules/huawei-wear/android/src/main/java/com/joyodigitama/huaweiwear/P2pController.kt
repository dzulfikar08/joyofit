package com.joyodigitama.huaweiwear

import android.content.Context
import android.database.sqlite.SQLiteException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.utils.HuaweiP2PSubMsg

/**
 * Owner of the P2P features across connections (the way [PhoneFeatures] owns its subscriptions): builds a
 * [P2pStack] on every new session when the link reaches CONNECTED, registers the services Huawei gates by
 * ExpandCapability, runs the health dictionary sync as an extension of the activity sync, and answers the watch's
 * Healthy Living requests.
 */
internal class P2pController(
  context: Context,
  val settings: P2pSettings,
  private val link: WearLink,
  private val wearSettings: WearSettings,
  private val syncStore: SyncStore,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) {
  private val appContext = context.applicationContext
  private val metrics = HealthMetricsStore(syncStore) { link.handle()?.address }

  @Volatile
  private var stack: P2pStack? = null
  private var attached: HuaweiSession? = null

  /** The offline-map lab (experimental switch, off by default). */
  val offlineMaps = OfflineMapLab(context, settings, link, events, scope) { stack }

  init {
    // The dictionary sync runs inside the activity sync, under its operation lock, after the workouts.
    link.syncExtensions.add { _ -> syncHealthMetrics() }
  }

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private fun error(message: String) = events.log(LogDirection.ERROR, null, null, null, message)

  /** The live stack, or null when the watch is not connected or has no P2P service. */
  fun stack(): P2pStack? = stack

  @Synchronized
  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED, LinkState.SYNCING -> {
        val handle = link.handle() ?: return
        if (handle.session === attached) return
        detach()
        attached = handle.session
        val created = P2pStack(
          handle.session, events, settings,
          { manager -> HealthModelService(manager, settings, events, scope, ::loadDay, ::goals) },
          { HeartRateZonesSync.age(wearSettings.profile) },
          { wearSettings.heartRateZones },
          { manager ->
            QuickRepliesService(
              manager, events, { settings.quickReplies },
              { replies -> settings.quickRepliesSent == sentKey(replies) },
              { replies -> settings.quickRepliesSent = sentKey(replies) },
            )
          },
        )
        stack = created
        created.start()
        created.registerServices()
        offlineMaps.attach(created)
        scope.launch(Dispatchers.IO) { recordGates(created) }
      }
      LinkState.DISCONNECTED -> detach()
      else -> Unit
    }
  }

  private fun detach() {
    stack?.close()
    stack = null
    attached = null
  }

  private fun recordGates(created: P2pStack) {
    val dictionary = created.dictionary ?: return
    try {
      HealthMetricsSync(created, metrics, events).recordGates(dictionary)
    } catch (e: SQLiteException) {
      error("Health metric gates not stored: ${e.message}")
    }
  }

  /** Called from the activity sync under the operation lock; never throws except for a lost link or cancellation. */
  private suspend fun syncHealthMetrics() {
    val current = stack ?: run {
      log("Health metrics: no P2P stack (the watch lists no 34/01); skipped")
      return
    }
    try {
      val result = HealthMetricsSync(current, metrics, events).sync() ?: return
      log("Health metrics: ${result.total} rows stored" + if (result.failed.isNotEmpty()) ", failed: ${result.failed.joinToString()}" else "")
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      error("Health metrics sync failed: ${e.message}")
    } catch (e: Exception) {
      error("Health metrics sync failed: ${e.message ?: e.javaClass.simpleName}")
    }
    // The day may have changed with the sync: tell the watch's Healthy Living, as Huawei Health does after data changes.
    current.healthModel?.push("activity sync")
  }

  // Healthy Living

  private fun loadDay(requestedDay: Int): HealthDay =
    HealthModelData.load(syncStore.db(), requestedDay, wearSettings.profile?.dailyStepGoal ?: 0, System.currentTimeMillis())

  private fun goals() = HealthGoals()

  private fun sentKey(replies: List<String>) = "${link.handle()?.address}|${QuickRepliesPacket.fingerprint(replies)}"

  fun quickRepliesStatus(): Map<String, Any?> = mapOf(
    "supported" to (stack?.quickReplies != null),
    "slots" to QuickRepliesPacket.SLOTS,
    "maxLength" to QuickRepliesPacket.MAX_LENGTH,
  )

  /** Stores [replies] and, when the watch takes them, sends them now (once; a reconnect sends only a changed list). Rejects an invalid list. */
  fun setQuickReplies(replies: List<String>): Boolean {
    val problem = QuickRepliesPacket.problem(replies)
    if (problem != null) throw WearException(ErrorCodes.INVALID_ARGUMENT, problem)
    settings.quickReplies = replies
    val service = stack?.quickReplies ?: return false
    if (settings.quickRepliesSent == sentKey(replies)) return true
    return service.send(replies)
  }

  fun healthLivingStatus(): Map<String, Any?> {
    val current = stack
    val service = current?.healthModel
    return mapOf(
      "supported" to (current != null && DeviceCaps.expandCapability(37)),
      "gate" to "ExpandCapability 37",
      "gateSet" to DeviceCaps.expandCapability(37),
      "enabled" to settings.healthLivingEnabled,
      "registered" to (service != null),
      "pingCode" to service?.pingCode,
      "msgVer" to settings.healthLivingMsgVer.takeIf { it > 0f }?.toDouble(),
      "packageSize" to settings.healthLivingPackageSize,
      "lastRequestAt" to settings.healthLivingLastRequestMs.takeIf { it > 0 },
      "lastReportAt" to settings.healthLivingLastReportMs.takeIf { it > 0 },
      "lastReport" to settings.healthLivingLastSummary,
    )
  }

  fun setHealthLivingEnabled(enabled: Boolean) {
    settings.healthLivingEnabled = enabled
    // Registration happens on connect; the change applies from the next connection (or now when switching off).
    if (!enabled) stack?.healthModel?.unregister()
  }

  /** Sends today's report now, as a push; false when the watch has not asked before (its msgVer is unknown). */
  suspend fun pushHealthLiving(): Boolean {
    val service = stack?.healthModel ?: throw WearException(ErrorCodes.UNSUPPORTED, "Healthy Living is not available: the watch is not connected, does not set ExpandCapability 37, or the feature is off")
    if (settings.healthLivingMsgVer <= 0f) return false
    withContext(Dispatchers.IO) { service.push("manual") }
    return true
  }

  // Running courses (experimental, off by default)

  fun coursesStatus(): Map<String, Any?> = mapOf(
    "enabled" to settings.experimentalCourses,
    // Huawei Health gates on ExpandCapability 41 (intelligent run plan) or 169 (AI fitness plan).
    "gate41" to DeviceCaps.expandCapability(41),
    "gate169" to DeviceCaps.expandCapability(169),
    "gate295" to DeviceCaps.expandCapability(295),
    "p2p" to (stack != null),
  )

  /**
   * Pushes [course] to the watch's `in.huawei.fitness` app as `<messageId>courseInfo.bin` (see [CourseProtobuf]). The flow follows
   * Huawei Health's behaviour; nothing of it has been seen on a watch, so every step is logged and the result reports what the
   * watch said, including the body of its answer message.
   */
  suspend fun pushCourse(course: RunningCourse): Map<String, Any?> {
    if (!settings.experimentalCourses) {
      throw WearException(ErrorCodes.UNSUPPORTED, "Running courses are an experimental feature; switch them on in the app first")
    }
    CourseProtobuf.validate(course)
    val handle = link.handle() ?: throw WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch")
    val current = stack ?: throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not list the P2P service (34/01)")
    val gate41 = DeviceCaps.expandCapability(41)
    val gate169 = DeviceCaps.expandCapability(169)
    log("Courses: gates ExpandCapability 41=$gate41 169=$gate169 295=${DeviceCaps.expandCapability(295)} (Huawei Health: 41 or 169)")
    if (!gate41 && !gate169) {
      throw WearException(ErrorCodes.UNSUPPORTED, "The watch sets neither ExpandCapability 41 nor 169, the bits Huawei Health requires before it pushes a course")
    }
    val registered = readyFitnessService(current, "Courses")

    val messageId = HuaweiP2PSubMsg.getNext()
    val updateTime = (System.currentTimeMillis() / 1000).toInt()
    val payload = CourseProtobuf.encode(course, updateTime)
    val file = CourseProtobuf.message(CourseProtobuf.BUSINESS_CUSTOM_COURSE, messageId, payload)
    val fileName = CourseProtobuf.fileName(messageId)
    log("Courses: ${course.name}: ${course.actionCount} steps, CourseStorageInfo ${payload.size} bytes, $fileName ${file.size} bytes: ${file.toHex()}")

    val answer = registered.expectAnswer(messageId)
    try {
      val outcome = handle.operationLock.withLock {
        val route = P2pRoute(FitnessCourseService.MODULE, FitnessCourseService.PACKAGE, registered.localFingerprint, FitnessCourseService.FINGERPRINT)
        FileUploader(handle.session, events, { bytes, total -> events.uploadProgress(bytes, total) })
          .upload(UploadFile(fileName, FILE_TYPE_P2P, file, route))
      }
      val reply = withTimeoutOrNull(ANSWER_WAIT_MS) { answer.await() }
      log(
        "Courses: upload finished, watch result status=${outcome.resultStatus ?: "none"}; answer message " +
          (reply?.let { "body ${it.toHex().ifEmpty { "(empty)" }}" } ?: "none within ${ANSWER_WAIT_MS / 1000} s"),
      )
      return mapOf(
        "messageId" to messageId,
        "fileName" to fileName,
        "bytes" to file.size,
        "uploadStatus" to outcome.resultStatus,
        "answered" to (reply != null),
        "answerHex" to reply?.toHex(),
      )
    } finally {
      registered.forget(messageId)
    }
  }

  /** The `fitness` P2P service of this connection, registered if needed, once it answered the ping (or [PING_WAIT_MS] passed; the send goes on anyway). */
  private suspend fun readyFitnessService(current: P2pStack, label: String): FitnessCourseService {
    var service = current.manager.getRegisteredService(FitnessCourseService.MODULE) as? FitnessCourseService
    if (service == null) {
      service = FitnessCourseService(current.manager, events)
      service.register()
    }
    val registered = service
    val ready = withTimeoutOrNull(PING_WAIT_MS) {
      while (registered.pingCode == null) delay(100)
      true
    }
    log("$label: ping of ${FitnessCourseService.PACKAGE} -> ${registered.pingCode?.let { "0x%02x".format(it and 0xFF) } ?: "no answer in ${PING_WAIT_MS} ms"}; sending anyway")
    if (ready != true) log("$label: the fitness app did not answer the ping; the upload may be refused")
    return registered
  }

  // Routes (navigation on the watch)

  /** The watch's route gates (Huawei Health's `RouteTransferDataHolder`): 70 deliver, 216 altitude profile, 218 picture, 272 scene types, 318 climb. */
  fun routesStatus(): Map<String, Any?> = mapOf(
    "p2p" to (stack != null),
    "deliver" to DeviceCaps.expandCapability(ROUTE_DELIVER_BIT),
    "altitude" to DeviceCaps.expandCapability(ROUTE_ALTITUDE_BIT),
    "image" to DeviceCaps.expandCapability(ROUTE_IMAGE_BIT),
    "sceneTypes" to DeviceCaps.expandCapability(ROUTE_SCENE_BIT),
    "climb" to DeviceCaps.expandCapability(ROUTE_CLIMB_BIT),
  )

  /**
   * Puts [route] on the watch the way Huawei Health's "Send to wearable" does (and GB's `HuaweiP2PFitnessData.sendTrack`): a P2P message of type 5 with the
   * route's name, the watch's answer (code, point limit), the route as a P2P file of type 6 (`byte.bin`), the watch's answer to that. Every step is logged.
   */
  suspend fun pushRoute(route: RouteTrack): Map<String, Any?> {
    RouteFile.validate(route)
    val handle = link.handle() ?: throw WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch")
    val current = stack ?: throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not list the P2P service (34/01)")
    val deliver = DeviceCaps.expandCapability(ROUTE_DELIVER_BIT)
    val altitudeGate = DeviceCaps.expandCapability(ROUTE_ALTITUDE_BIT)
    log("Routes: gates ExpandCapability 70 (deliver)=$deliver 216 (altitude)=$altitudeGate 218=${DeviceCaps.expandCapability(ROUTE_IMAGE_BIT)} 272=${DeviceCaps.expandCapability(ROUTE_SCENE_BIT)} 318=${DeviceCaps.expandCapability(ROUTE_CLIMB_BIT)}")
    if (!deliver) throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not set ExpandCapability 70, the bit Huawei Health requires before it sends a route")
    val service = readyFitnessService(current, "Routes")

    // Without ExpandCapability 216 Huawei Health sends the plain line: version 1, no altitude, no marker points.
    val version = if (altitudeGate) 2 else 1
    val track = RouteTrack(route.id, route.name, route.fixes, route.hasAltitude && version == 2, route.totalTimeSec, version)

    val handshakeAnswer = service.expectRouteAnswer(RouteFile.BUSINESS_ROUTE_HANDSHAKE)
    val fileAnswer = service.expectRouteAnswer(RouteFile.BUSINESS_ROUTE_FILE)
    try {
      val handshake = HuaweiP2PSubMsg(RouteFile.BUSINESS_ROUTE_HANDSHAKE, HuaweiP2PSubMsg.getNext(), RouteFile.handshakeBody(track.name)).bytes
      log("Routes: handshake for \"${track.name}\": ${handshake.toHex()}")
      val ack = CompletableDeferred<Int>()
      service.sendCommand(handshake) { code, _ -> ack.complete(code) }
      val ackCode = withTimeoutOrNull(ANSWER_WAIT_MS) { awaitAnswer(ack) }
      log("Routes: handshake acknowledged with ${ackCode?.let { "0x%02x".format(it and 0xFF) } ?: "nothing in ${ANSWER_WAIT_MS / 1000} s"} (0xcf = received)")
      if (ackCode != null && (ackCode and 0xFF) != 0xCF) {
        throw WearException(ErrorCodes.UPLOAD_REJECTED, "The watch did not take the route handshake (0x%02x)".format(ackCode and 0xFF), statusCode = ackCode and 0xFF)
      }
      val handshakeBody = withTimeoutOrNull(ANSWER_WAIT_MS) { awaitAnswer(handshakeAnswer) }
        ?: throw WearException(ErrorCodes.TIMEOUT, "The watch did not answer the route handshake within ${ANSWER_WAIT_MS / 1000} s")
      val answer = RouteFile.parseAnswer(handshakeBody)
      log("Routes: handshake answer body ${handshakeBody.toHex().ifEmpty { "(empty)" }} -> code ${answer?.code}, point limit ${answer?.maxPoints}")
      when (answer?.code) {
        1 -> Unit
        3 -> return routePushResult(ok = true, alreadyOnWatch = true, handshakeCode = 3, maxPoints = answer?.maxPoints, version = 0, sentPoints = 0, bytes = 0, uploadStatus = null, answerCode = null)
        2 -> throw WearException(ErrorCodes.ROUTE_FULL, "The watch's route list is full", statusCode = 2)
        5 -> throw WearException(ErrorCodes.ROUTE_NAME, "The watch does not take a route name this long", statusCode = 5)
        else -> throw WearException(ErrorCodes.UPLOAD_REJECTED, "The watch refused the route (handshake code ${answer?.code ?: "none"})", statusCode = answer?.code)
      }

      val limit = RouteFile.pointLimit(answer)
      val body = RouteFile.convert(track, limit)
      if (body.isEmpty()) throw WearException(ErrorCodes.INVALID_ARGUMENT, "The route could not be converted for the watch")
      val messageId = HuaweiP2PSubMsg.getNext()
      val file = RouteFile.message(RouteFile.BUSINESS_ROUTE_FILE, messageId, body)
      val sentPoints = RouteFile.pointCount(body, version)
      log("Routes: ${track.name}: ${track.fixes.size} points -> $sentPoints (limit $limit), version $version, ${RouteFile.FILE_NAME} ${file.size} bytes: ${file.toHex()}")

      val outcome = handle.operationLock.withLock {
        val p2p = P2pRoute(FitnessCourseService.MODULE, FitnessCourseService.PACKAGE, service.localFingerprint, FitnessCourseService.FINGERPRINT)
        FileUploader(handle.session, events, { bytes, total -> events.uploadProgress(bytes, total) })
          .upload(UploadFile(RouteFile.FILE_NAME, FILE_TYPE_P2P, file, p2p))
      }
      val fileBody = withTimeoutOrNull(ANSWER_WAIT_MS) { awaitAnswer(fileAnswer) }
      val fileCode = fileBody?.let { RouteFile.parseAnswer(it)?.code }
      log(
        "Routes: upload finished, watch result status=${outcome.resultStatus ?: "none"}; file answer " +
          (fileBody?.let { "body ${it.toHex().ifEmpty { "(empty)" }} -> code $fileCode" } ?: "none within ${ANSWER_WAIT_MS / 1000} s"),
      )
      if (fileCode != null && fileCode != 1) {
        throw WearException(ErrorCodes.UPLOAD_REJECTED, "The watch did not save the route (code $fileCode)", statusCode = fileCode)
      }
      return routePushResult(
        ok = true, alreadyOnWatch = false, handshakeCode = 1, maxPoints = answer?.maxPoints, version = version, sentPoints = sentPoints,
        bytes = file.size, uploadStatus = outcome.resultStatus, answerCode = fileCode,
      )
    } finally {
      service.forgetRouteAnswer(RouteFile.BUSINESS_ROUTE_HANDSHAKE)
      service.forgetRouteAnswer(RouteFile.BUSINESS_ROUTE_FILE)
    }
  }

  /** A waiter cancelled by the service (the link went away) is a lost connection, not a cancelled call. */
  private suspend fun <T> awaitAnswer(waiter: CompletableDeferred<T>): T = try {
    waiter.await()
  } catch (e: CancellationException) {
    currentCoroutineContext().ensureActive()
    throw WearException(ErrorCodes.DISCONNECTED, "The watch disconnected while the route was being sent")
  }

  private fun routePushResult(
    ok: Boolean, alreadyOnWatch: Boolean, handshakeCode: Int?, maxPoints: Int?, version: Int, sentPoints: Int, bytes: Int, uploadStatus: Int?, answerCode: Int?,
  ): Map<String, Any?> = mapOf(
    "ok" to ok,
    "alreadyOnWatch" to alreadyOnWatch,
    "handshakeCode" to handshakeCode,
    "maxPoints" to maxPoints,
    "version" to version,
    "sentPoints" to sentPoints,
    "bytes" to bytes,
    "uploadStatus" to uploadStatus,
    "answerCode" to answerCode,
  )

  private companion object {
    const val PING_WAIT_MS = 4_000L
    const val ANSWER_WAIT_MS = 10_000L

    /** GB uses file type 7 for every P2P file (`HuaweiP2PFitnessData`, `HuaweiP2PContactsService`, ...). */
    const val FILE_TYPE_P2P: Byte = 7

    /** ExpandCapability bits of Huawei Health's `RouteTransferDataHolder`. */
    const val ROUTE_DELIVER_BIT = 70
    const val ROUTE_ALTITUDE_BIT = 216
    const val ROUTE_IMAGE_BIT = 218
    const val ROUTE_SCENE_BIT = 272
    const val ROUTE_CLIMB_BIT = 318
  }
}
