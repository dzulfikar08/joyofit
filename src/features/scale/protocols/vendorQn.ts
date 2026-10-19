/**
 * Connected (GATT) protocols ported from openScale that share the QN / 1byone / Renpho families.
 * Copyright (C) olie.xdev, GPL-3.0-or-later (https://github.com/oliexdev/openScale); see each module for its sources and vectors.
 */
import type { ScaleProtocol } from '../types';
import { ONE_BY_ONE_PROTOCOLS } from './oneByone';
import { ONE_BY_ONE_NEW_PROTOCOL } from './oneByoneNew';
import { QN_PROTOCOL } from './qn';
import { RENPHO_PROTOCOL } from './renpho';

export const VENDOR_QN_PROTOCOLS: ScaleProtocol[] = [QN_PROTOCOL, ...ONE_BY_ONE_PROTOCOLS, ONE_BY_ONE_NEW_PROTOCOL, RENPHO_PROTOCOL];
