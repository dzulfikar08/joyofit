package com.joyodigitama.huaweiwear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BackgroundRestrictionsTest {
  private fun restrictions(
    ignoring: Boolean = false,
    restricted: Boolean = false,
    manufacturer: String = "INFINIX",
    brand: String = "Infinix",
    vendor: PhoneVendor? = PhoneVendor.of(manufacturer, brand),
    direct: Boolean = true,
  ) = BackgroundRestrictions(ignoring, restricted, manufacturer, brand, vendor, direct)

  // The phone makers with an auto-start list

  @Test
  fun transsionPhonesAreRecognisedByMakerOrBrand() {
    assertEquals(PhoneVendor.TRANSSION, PhoneVendor.of("INFINIX", "Infinix"))
    assertEquals(PhoneVendor.TRANSSION, PhoneVendor.of("TECNO", "TECNO"))
    assertEquals(PhoneVendor.TRANSSION, PhoneVendor.of("itel", "itel"))
    assertEquals(PhoneVendor.TRANSSION, PhoneVendor.of("Transsion Holdings", "Infinix"))
    assertEquals(PhoneVendor.TRANSSION, PhoneVendor.of("unknown", "TECNO"))
  }

  @Test
  fun xiaomiOppoAndVivoFamiliesAreRecognised() {
    assertEquals(PhoneVendor.XIAOMI, PhoneVendor.of("Xiaomi", "Redmi"))
    assertEquals(PhoneVendor.XIAOMI, PhoneVendor.of("Xiaomi", "POCO"))
    assertEquals(PhoneVendor.OPPO, PhoneVendor.of("OPPO", "OPPO"))
    assertEquals(PhoneVendor.OPPO, PhoneVendor.of("realme", "realme"))
    assertEquals(PhoneVendor.VIVO, PhoneVendor.of("vivo", "vivo"))
    assertEquals(PhoneVendor.VIVO, PhoneVendor.of("vivo", "iQOO"))
  }

  @Test
  fun otherMakersHaveNoVendorList() {
    assertNull(PhoneVendor.of("samsung", "samsung"))
    assertNull(PhoneVendor.of("Google", "google"))
    assertNull(PhoneVendor.of(null, null))
    assertNull(PhoneVendor.of("", ""))
  }

  @Test
  fun everyVendorHasScreensToTryAndAWireName() {
    for (vendor in PhoneVendor.values()) {
      assertTrue(vendor.name, vendor.screens.isNotEmpty())
      assertTrue(vendor.name, vendor.screens.all { it.packageName.isNotBlank() && it.className.contains('.') })
      assertEquals(vendor.name.lowercase(), vendor.wire)
    }
  }

  // What the notice and the report say

  @Test
  fun aPhoneThatMayStopTheAppIsLimited() {
    assertTrue(restrictions().limited)
    assertTrue(restrictions(restricted = true, ignoring = true).limited)
    assertFalse(restrictions(ignoring = true).limited)
  }

  @Test
  fun theJsObjectCarriesExactlyTheTypeScriptFields() {
    val js = restrictions(ignoring = true, restricted = false).toJs()

    assertEquals(setOf("ignoringBatteryOptimizations", "backgroundRestricted", "manufacturer", "autoStartVendor", "canRequestDirectly"), js.keys)
    assertEquals(true, js["ignoringBatteryOptimizations"])
    assertEquals(false, js["backgroundRestricted"])
    assertEquals("INFINIX", js["manufacturer"])
    assertEquals("transsion", js["autoStartVendor"])
    assertEquals(true, js["canRequestDirectly"])
    assertNull(restrictions(manufacturer = "samsung", brand = "samsung").toJs()["autoStartVendor"])
  }

  @Test
  fun theReportLineSaysMakerBatteryRestrictionPromptAndAutoStart() {
    val line = restrictions().summaryLine()

    assertTrue(line, line.contains("manufacturer INFINIX (brand Infinix)"))
    assertTrue(line, line.contains("JoyoFit is NOT exempt"))
    assertTrue(line, line.contains("background restriction: off"))
    assertTrue(line, line.contains("direct exemption prompt: available (sideload build)"))
    assertTrue(line, line.contains("transsion phones keep a list of allowed apps"))
  }

  @Test
  fun theReportLineOfAFixedPlayBuildPhoneSaysSo() {
    val line = restrictions(ignoring = true, direct = false, manufacturer = "samsung", brand = "samsung").summaryLine()

    assertTrue(line, line.contains("JoyoFit is exempt"))
    assertTrue(line, line.contains("not offered (Google Play build)"))
    assertTrue(line, line.contains("no vendor list known"))
  }

  @Test
  fun aRestrictedAppIsReportedAsNotAllowedToRun() {
    assertTrue(restrictions(restricted = true).summaryLine().contains("background restriction: ON"))
  }

  // Which screens "allow JoyoFit" opens

  @Test
  fun anAppThatIsNotExemptAsksDirectlyOnlyWhereTheBuildMay() {
    assertEquals(
      listOf(BatteryExemption.Step.REQUEST_EXEMPTION, BatteryExemption.Step.OPTIMIZATION_LIST, BatteryExemption.Step.APP_DETAILS),
      BatteryExemption.plan(canRequestDirectly = true, ignoring = false, restricted = false),
    )
    // Google Play: no direct prompt, the system's list instead.
    assertEquals(
      listOf(BatteryExemption.Step.OPTIMIZATION_LIST, BatteryExemption.Step.APP_DETAILS),
      BatteryExemption.plan(canRequestDirectly = false, ignoring = false, restricted = false),
    )
  }

  @Test
  fun aRestrictedAppIsLiftedOnItsOwnSettingsScreenWhateverTheBuild() {
    for (direct in listOf(true, false)) {
      for (ignoring in listOf(true, false)) {
        assertEquals(listOf(BatteryExemption.Step.APP_DETAILS), BatteryExemption.plan(direct, ignoring, restricted = true))
      }
    }
  }

  @Test
  fun anExemptAppOnlyHasItsDetailsToOpen() {
    assertEquals(listOf(BatteryExemption.Step.APP_DETAILS), BatteryExemption.plan(canRequestDirectly = true, ignoring = true, restricted = false))
  }

  @Test
  fun theGooglePlayBuildNeverPlansTheDirectPrompt() {
    for (ignoring in listOf(true, false)) {
      for (restricted in listOf(true, false)) {
        assertFalse(BatteryExemption.plan(canRequestDirectly = false, ignoring = ignoring, restricted = restricted).contains(BatteryExemption.Step.REQUEST_EXEMPTION))
      }
    }
  }
}
