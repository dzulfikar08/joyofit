package com.joyodigitama.huaweiwear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MediaSessionPickTest {
  private data class Session(val pkg: String, val playing: Boolean)

  private fun pick(vararg sessions: Session) =
    pickMediaSession(sessions.toList(), OWN, { it.pkg }, { it.playing })

  @Test
  fun aPlayingSessionWinsOverTheFirst() {
    assertEquals(Session("music.b", true), pick(Session("music.a", false), Session("music.b", true)))
  }

  @Test
  fun withNothingPlayingTheFirstInTheSystemOrderWins() {
    assertEquals(Session("music.a", false), pick(Session("music.a", false), Session("music.b", false)))
  }

  @Test
  fun joyofitsOwnSessionIsNeverPicked() {
    // Paused music behind an app session at the top of the list (the case a click player with a MediaSession caused).
    assertEquals(Session("music.a", false), pick(Session(OWN, true), Session("music.a", false)))
    assertNull(pick(Session(OWN, false)))
  }

  private companion object {
    const val OWN = "com.joyodigitama.joyofit"
  }
}
