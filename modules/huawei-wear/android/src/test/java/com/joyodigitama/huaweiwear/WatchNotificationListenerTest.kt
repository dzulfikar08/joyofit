package com.joyodigitama.huaweiwear

import android.app.Notification
import android.os.UserHandle
import android.service.notification.StatusBarNotification
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchNotificationListenerTest {
  private fun fakeSbn(): StatusBarNotification =
    StatusBarNotification(
      "com.spotify.music",
      "com.spotify.music",
      42,
      "tag",
      1000,
      1000,
      0,
      Notification(),
      UserHandle.getUserHandleForUid(0),
      System.currentTimeMillis(),
    )

  @Test
  fun voipCallNotificationReturnsEarlyWithoutForwardingOrTouchingMedia() {
    val sbn = fakeSbn()
    var mediaCalled = false
    var forwardCalled = false

    dispatchNotificationPosted(
      sbn = sbn,
      isVoipCall = { true },
      onMedia = { mediaCalled = true },
      onForward = { forwardCalled = true },
    )

    assertFalse("VoIP calls must not reach media control", mediaCalled)
    assertFalse("VoIP calls must not be forwarded as ordinary notifications", forwardCalled)
  }

  @Test
  fun mediaAndRegularNotificationsAlwaysContinueToForwarder() {
    val sbn = fakeSbn()
    var capturedMediaSbn: StatusBarNotification? = null
    var capturedForwardSbn: StatusBarNotification? = null

    dispatchNotificationPosted(
      sbn = sbn,
      isVoipCall = { false },
      onMedia = { capturedMediaSbn = it },
      onForward = { capturedForwardSbn = it },
    )

    assertEquals(sbn, capturedMediaSbn)
    assertEquals(sbn, capturedForwardSbn)
  }
}
