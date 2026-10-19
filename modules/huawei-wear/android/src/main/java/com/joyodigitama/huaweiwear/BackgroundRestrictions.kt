package com.joyodigitama.huaweiwear

import android.app.ActivityManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import java.util.Locale

/**
 * Phone makers whose Android stops background apps on top of the system's battery optimization: each has an "auto-start" list the app has
 * to be allowed in. [wire] is what JS reads (`BackgroundRestrictions.autoStartVendor`).
 */
internal enum class PhoneVendor(val wire: String, private val prefixes: List<String>) {
  /** Infinix, Tecno, itel (HiOS, XOS, itelOS). */
  TRANSSION("transsion", listOf("transsion", "infinix", "tecno", "itel")),
  XIAOMI("xiaomi", listOf("xiaomi", "redmi", "poco")),
  /** OPPO and realme (ColorOS, realme UI). */
  OPPO("oppo", listOf("oppo", "realme")),
  VIVO("vivo", listOf("vivo", "iqoo")),
  ;

  /**
   * A vendor screen that lists the apps allowed to start by themselves, as an explicit component. These names come from community lists
   * of each maker's settings app and change between versions [INFERENCE: not opened on a device by this project]; [BatteryExemption.launch]
   * tries them in order and the app details screen is the answer when none opens.
   */
  class Screen(val packageName: String, val className: String)

  val screens: List<Screen>
    get() = when (this) {
      TRANSSION -> listOf(
        Screen("com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity"),
        Screen("com.transsion.phonemanager", "com.itel.autobootmanager.activity.AutoBootMgrActivity"),
      )
      XIAOMI -> listOf(Screen("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"))
      OPPO -> listOf(
        Screen("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
        Screen("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
        Screen("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
      )
      VIVO -> listOf(
        Screen("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
        Screen("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"),
        Screen("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
      )
    }

  companion object {
    /** The group of `Build.MANUFACTURER` or `Build.BRAND` (either may carry the name: a Redmi reports Xiaomi, a realme reports realme); null for any other maker. */
    fun of(manufacturer: String?, brand: String?): PhoneVendor? {
      val names = listOfNotNull(manufacturer, brand).map { it.trim().lowercase(Locale.ROOT) }
      return values().firstOrNull { vendor -> names.any { name -> vendor.prefixes.any { name.startsWith(it) } } }
    }
  }
}

/**
 * Whether Android may stop JoyoFit while the screen is off, the cause the watch "drops by itself" reports point at: Doze and App Standby
 * cut the background service's network and wake locks unless the app is exempt from battery optimization, and a "Restricted" app is not
 * allowed to run in the background at all. [toJs] is `BackgroundRestrictions` in `HuaweiWear.types.ts`.
 */
internal data class BackgroundRestrictions(
  val ignoringBatteryOptimizations: Boolean,
  val backgroundRestricted: Boolean,
  val manufacturer: String,
  val brand: String,
  val vendor: PhoneVendor?,
  /** The build may show the system's "Allow" prompt for the exemption ([Distribution.canRequestBatteryExemption]). */
  val canRequestDirectly: Boolean,
) {
  /** True when the phone may still stop the connection: not exempt, or restricted. */
  val limited: Boolean get() = !ignoringBatteryOptimizations || backgroundRestricted

  fun toJs(): Map<String, Any?> = mapOf(
    "ignoringBatteryOptimizations" to ignoringBatteryOptimizations,
    "backgroundRestricted" to backgroundRestricted,
    "manufacturer" to manufacturer,
    "autoStartVendor" to vendor?.wire,
    "canRequestDirectly" to canRequestDirectly,
  )

  /** The line of the support report. Auto-start cannot be read from Android, so it says only which vendor screen applies. */
  fun summaryLine(): String =
    "Background limits: manufacturer $manufacturer (brand $brand), " +
      "battery optimization: ${if (ignoringBatteryOptimizations) "JoyoFit is exempt" else "JoyoFit is NOT exempt, Android may stop it while the screen is off"}, " +
      "background restriction: ${if (backgroundRestricted) "ON, JoyoFit may not run in the background" else "off"}, " +
      "direct exemption prompt: ${if (canRequestDirectly) "available (sideload build)" else "not offered (Google Play build)"}, " +
      "auto-start: ${if (vendor != null) "cannot be read; ${vendor.wire} phones keep a list of allowed apps" else "no vendor list known"}"

  companion object {
    fun read(context: Context): BackgroundRestrictions {
      val app = context.applicationContext
      val power = app.getSystemService(PowerManager::class.java)
      val activity = app.getSystemService(ActivityManager::class.java)
      return BackgroundRestrictions(
        ignoringBatteryOptimizations = power?.isIgnoringBatteryOptimizations(app.packageName) ?: false,
        backgroundRestricted = activity?.isBackgroundRestricted ?: false,
        manufacturer = Build.MANUFACTURER,
        brand = Build.BRAND,
        vendor = PhoneVendor.of(Build.MANUFACTURER, Build.BRAND),
        canRequestDirectly = Distribution.canRequestBatteryExemption,
      )
    }
  }
}

/** What "allow JoyoFit to run in the background" opens, in order, and the intents behind it. */
internal object BatteryExemption {
  enum class Step {
    /** The system's own "let this app ignore battery optimization?" dialog (needs `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, sideload builds only). */
    REQUEST_EXEMPTION,

    /** Android's list of apps with battery optimization (no permission needed; the person picks JoyoFit there). */
    OPTIMIZATION_LIST,

    /** This app's own settings screen, where its Battery entry (Unrestricted) and, on some phones, auto-start live. */
    APP_DETAILS,
  }

  /**
   * The screens to try, first one that opens wins. A "Restricted" app is lifted only on its app details screen (the exemption dialog
   * leaves the restriction); an app that is not exempt gets the direct dialog where the build may ask for it, else the system list.
   * The Google Play build never asks directly: Play allows that prompt only where Doze breaks the app's core function, and for a peripheral
   * companion that syncs periodically Android's own table of acceptable cases says it is not acceptable (docs/play-store.md).
   */
  fun plan(canRequestDirectly: Boolean, ignoring: Boolean, restricted: Boolean): List<Step> = when {
    restricted -> listOf(Step.APP_DETAILS)
    !ignoring && canRequestDirectly -> listOf(Step.REQUEST_EXEMPTION, Step.OPTIMIZATION_LIST, Step.APP_DETAILS)
    !ignoring -> listOf(Step.OPTIMIZATION_LIST, Step.APP_DETAILS)
    else -> listOf(Step.APP_DETAILS)
  }

  fun intent(step: Step, packageName: String): Intent = when (step) {
    Step.REQUEST_EXEMPTION -> Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
    Step.OPTIMIZATION_LIST -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
    Step.APP_DETAILS -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null))
  }

  /** Auto-start: the maker's own screen when [vendor] has candidates that open, else this app's details. */
  fun autoStartIntents(vendor: PhoneVendor?, packageName: String): List<Intent> =
    vendor?.screens.orEmpty().map { Intent().setComponent(ComponentName(it.packageName, it.className)) } + intent(Step.APP_DETAILS, packageName)

  /**
   * Starts the first intent that opens, true on success. A maker's activity may be missing (ActivityNotFoundException) or not exported
   * (SecurityException): both just mean "try the next one". An explicit component is started without resolving it first, because Android 11+
   * hides other apps from `resolveActivity`.
   */
  fun launch(context: Context, intents: List<Intent>): Boolean {
    for (intent in intents) {
      try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
      } catch (e: ActivityNotFoundException) {
        continue
      } catch (e: SecurityException) {
        continue
      }
    }
    return false
  }
}
