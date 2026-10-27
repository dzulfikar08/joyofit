package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

/**
 * Songs on the watch, lab (`getWatchMusic` ... `deleteWatchSongs` in `HuaweiWearModule.ts`, types in `HuaweiWearMusic.types.ts`;
 * [WatchMusicController]). Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.watchMusicApi(runtime: () -> WearRuntime) {
  Function("getWatchMusic") {
    runtime().watchMusic.status()
  }

  AsyncFunction("setWatchMusicLab") { enabled: Boolean ->
    runtime().watchMusic.setEnabled(enabled)
  }

  AsyncFunction("watchMusicInfo") Coroutine { ->
    runtime().watchMusic.info()
  }

  AsyncFunction("listWatchMusic") Coroutine { ->
    runtime().watchMusic.list()
  }

  AsyncFunction("uploadWatchSong") Coroutine { uri: String, name: String ->
    runtime().watchMusic.upload(uri, name)
  }

  AsyncFunction("cancelWatchMusicUpload") { ->
    runtime().watchMusic.cancel()
  }

  AsyncFunction("deleteWatchSongs") Coroutine { ids: List<Int> ->
    runtime().watchMusic.delete(ids)
  }
}
