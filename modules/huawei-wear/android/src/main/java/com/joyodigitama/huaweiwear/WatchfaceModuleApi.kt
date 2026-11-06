package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

/**
 * The watch face part of the `HuaweiWear` module (`listWatchfaces` ... `deleteWatchface` in
 * `HuaweiWearModule.ts`). Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.watchfaceApi(runtime: () -> WearRuntime) {
  AsyncFunction("listWatchfaces") Coroutine { ->
    runtime().watchfaces.list()
  }

  AsyncFunction("installWatchface") Coroutine { uri: String, signature: String?, fileName: String?, gadgetbridge: Boolean? ->
    runtime().watchfaces.install(uri, signature, fileName, gadgetbridge ?: false)
  }

  AsyncFunction("setActiveWatchface") Coroutine { id: String ->
    runtime().watchfaces.setActive(id)
  }

  AsyncFunction("deleteWatchface") Coroutine { id: String ->
    runtime().watchfaces.delete(id)
  }

  AsyncFunction("parseWatchfacePackage") Coroutine { uri: String, persist: Boolean? ->
    runtime().watchfaces.parsePackage(uri, persist ?: false)
  }

  AsyncFunction("deleteLocalWatchfaceFile") { uri: String ->
    runtime().watchfaces.deleteLocalFile(uri)
  }
}
