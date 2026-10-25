package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

/**
 * Satellite data (A-GPS / ephemeris) of the `HuaweiWear` module (`getAgps` ... `setAgpsPgnssLab` in `HuaweiWearModule.ts`).
 * Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.agpsApi(runtime: () -> WearRuntime) {
  Function("getAgps") {
    runtime().ephemeris.status()
  }

  AsyncFunction("refreshAgps") Coroutine { ->
    runtime().ephemeris.refreshNow()
  }

  AsyncFunction("cancelAgps") Coroutine { ->
    runtime().ephemeris.cancel()
  }

  // Experimental, off by default: serve JoyoFit's HW_AGNSS file to a watch that asks for exactly that kind (docs/agps.md, "Lab path").
  AsyncFunction("setAgpsLab") { enabled: Boolean ->
    runtime().ephemeris.setLabAgnss(enabled)
  }

  // Experimental, off by default and separate from the switch above: serve JoyoFit's six HW_PGNSS_* files to a watch that asks for HW_PGNSS_PRED.
  AsyncFunction("setAgpsPgnssLab") { enabled: Boolean ->
    runtime().ephemeris.setLabPgnss(enabled)
  }
}
