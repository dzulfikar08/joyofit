package com.joyodigitama.huaweiwear

import expo.modules.kotlin.modules.ModuleDefinitionBuilder
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** `WatchNavConfig` in `HuaweiWearWatchNav.types.ts`. */
class WatchNavConfigRecord : Record {
  @Field var phoneFingerprint: String = ""
  @Field var watchFingerprint: String = ""
}

/**
 * Watch navigation of the `HuaweiWear` module (`getWatchNav` ... `stopWatchNav` in `HuaweiWearModule.ts`, types in
 * `HuaweiWearWatchNav.types.ts`; [WatchNav]). Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.watchNavApi(runtime: () -> WearRuntime) {
  Function("getWatchNav") {
    runtime().p2p.watchNav.status()
  }

  AsyncFunction("setWatchNavLab") { enabled: Boolean ->
    runtime().p2p.watchNav.setEnabled(enabled)
  }

  AsyncFunction("startWatchNav") { config: WatchNavConfigRecord ->
    runtime().p2p.watchNav.start(WatchNavConfig(config.phoneFingerprint, config.watchFingerprint))
  }

  AsyncFunction("sendWatchNav") { json: String ->
    runtime().p2p.watchNav.send(json)
  }

  AsyncFunction("stopWatchNav") {
    runtime().p2p.watchNav.stop()
  }
}
