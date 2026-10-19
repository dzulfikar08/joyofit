package com.joyodigitama.blesensors

import expo.modules.kotlin.exception.CodedException

/** The error codes `BleSensorsModule.ts` documents. */
internal object ErrorCodes {
  const val BLUETOOTH_PERMISSION = "ERR_BLUETOOTH_PERMISSION"
  const val BLUETOOTH_OFF = "ERR_BLUETOOTH_OFF"
  const val BLUETOOTH_UNAVAILABLE = "ERR_BLUETOOTH_UNAVAILABLE"
  const val INVALID_ARGUMENT = "ERR_INVALID_ARGUMENT"
  const val LOCATION_PERMISSION = "ERR_LOCATION_PERMISSION"
  const val SERVICE_NOT_ALLOWED = "ERR_SERVICE_NOT_ALLOWED"
  const val SCALE_NOT_CONNECTED = "ERR_SCALE_NOT_CONNECTED"
  const val SCALE_NO_CHARACTERISTIC = "ERR_SCALE_NO_CHARACTERISTIC"
  const val SCALE_OPERATION_REFUSED = "ERR_SCALE_OPERATION_REFUSED"

  /** Followed by the GATT status number (`ERR_SCALE_GATT_133`). */
  const val SCALE_GATT_PREFIX = "ERR_SCALE_GATT_"
}

/** Every failure surfaced to JS is a [CodedException] with one of [ErrorCodes]. */
internal class SensorException(code: String, message: String, cause: Throwable? = null) : CodedException(code, message, cause)
