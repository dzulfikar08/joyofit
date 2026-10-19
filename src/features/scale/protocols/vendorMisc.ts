/** Registry of the smaller GATT vendors ported from openScale (see each file for attribution and sources). */
import type { ScaleProtocol } from '../types';
import { EXCELVAN_CF36X } from './excelvan';
import { EXINGTECH_Y1 } from './exingtech';
import { HESLEY } from './hesley';
import { INLIFE } from './inlife';
import { SENSSUN } from './senssun';
import { YUNMAI_PROTOCOLS } from './yunmai';

export const VENDOR_MISC_PROTOCOLS: ScaleProtocol[] = [...YUNMAI_PROTOCOLS, INLIFE, SENSSUN, EXCELVAN_CF36X, HESLEY, EXINGTECH_Y1];
