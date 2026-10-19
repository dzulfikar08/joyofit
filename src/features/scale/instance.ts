import { BleSensors } from '@/ble';

import { ScaleHub } from './hub';
import type { ScaleNative } from './native';

/** The one scan owner of the app's scale features. The native module is read on first use, so importing this file costs nothing. */
export const scaleHub = new ScaleHub(() => BleSensors as unknown as ScaleNative);
