package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

/**
 * The offline-map lab of the `HuaweiWear` module (`getOfflineMapLab` ... `deleteOfflineMap` in `HuaweiWearModule.ts`, types in
 * `HuaweiWearOfflineMaps.types.ts`; [OfflineMapLab]). Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.offlineMapApi(runtime: () -> WearRuntime) {
  Function("getOfflineMapLab") {
    runtime().p2p.offlineMaps.status()
  }

  AsyncFunction("setOfflineMapLab") { enabled: Boolean ->
    runtime().p2p.offlineMaps.setEnabled(enabled)
  }

  AsyncFunction("offlineMapFreeSpace") Coroutine { ->
    runtime().p2p.offlineMaps.freeSpace()
  }

  AsyncFunction("listOfflineMaps") Coroutine { ->
    runtime().p2p.offlineMaps.list()
  }

  AsyncFunction("inspectOfflineMap") Coroutine { uri: String, name: String ->
    runtime().p2p.offlineMaps.inspect(uri, name)
  }

  AsyncFunction("sendOfflineMap") Coroutine { uri: String, name: String ->
    runtime().p2p.offlineMaps.send(uri, name)
  }

  AsyncFunction("deleteOfflineMap") Coroutine { mapId: String, mapType: Int ->
    runtime().p2p.offlineMaps.delete(mapId, mapType)
  }
}
