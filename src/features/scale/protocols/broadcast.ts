/** Registry of the advertisement-only (no connection) scale protocols, most specific fingerprint first. */
import type { ScaleProtocol } from '../types';
import { aaaxProtocol } from './aaax';
import { aiLinkProtocol } from './ailink';
import { etekcityFit8sProtocol } from './etekcityFit8s';
import { okokProtocol } from './okok';
import { qnBroadcastProtocol } from './qnBroadcast';
import { scaleupProtocol } from './scaleup';

export const BROADCAST_PROTOCOLS: ScaleProtocol[] = [
  aiLinkProtocol,
  qnBroadcastProtocol,
  etekcityFit8sProtocol,
  okokProtocol,
  aaaxProtocol,
  // Last: it claims any nameless record whose company id low byte is 0xD0 / 0xE0.
  scaleupProtocol,
];
