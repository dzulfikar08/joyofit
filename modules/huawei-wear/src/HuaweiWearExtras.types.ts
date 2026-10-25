/** What the Safety settings screen shows (`getSafety`). */
export interface SafetyStatus {
  /** The watch reports what fall detection needs (DataSync configs and SupportedCommands `0x33/01`). */
  fallSupported: boolean;
  /** Why fall detection is or is not available, from the watch's capability report. */
  fallNote: string;
  /** The watch's fall detection switch as last seen: -1 unknown, 0 off, 1 on. */
  fallSwitch: -1 | 0 | 1;
  /** When `fallSwitch` was last set or reported, Unix milliseconds; 0 when never. */
  fallUpdatedMs: number;
  /** The user's switch for sending the SMS the watch asks for. Off by default; no SMS is ever sent while off. */
  sosRelayEnabled: boolean;
  /** This build can send SMS at all. False in the Google Play build, which has no SEND_SMS in its manifest. */
  smsSupported: boolean;
  /** SEND_SMS is granted. */
  smsPermission: boolean;
  telephony: boolean;
  /** The SIM card is ready to send. */
  simReady: boolean;
  /** An SOS request would be sent right now. */
  sosReady: boolean;
  /** Every reason a request would be refused (empty when ready). */
  sosBlockers: string[];
  /** The watch lists the SOS SMS command (`0x33/02`) in its capabilities. The relay answers the watch either way. */
  sosListedByWatch: boolean;
  /** The morning sleep report is on. */
  sleepReportEnabled: boolean;
  /** The watch reports DataSync events (ExpandCapability 84), which the report needs. */
  sleepReportSupported: boolean;
}

/** Result of `testSosRelay`: what the relay would do, nothing was sent. */
export interface SosRelayTest {
  ready: boolean;
  blockers: string[];
}

/** The reminder switches of the cycle calendar on the watch. */
export interface CycleSwitches {
  master: boolean;
  periodStart: boolean;
  periodEnd: boolean;
  fertileStart: boolean;
  fertileEnd: boolean;
  /** Only sent to watches reporting ExpandCapability 265. */
  easyPregnancy: boolean;
}

/** A logged period. `end` is null while it is going on. Days are local `YYYY-MM-DD`. */
export interface CyclePeriod {
  start: string;
  end: string | null;
}

/** Symptoms of one day, 0 (none) to 3. */
export interface CycleDay {
  day: string;
  flow: number;
  cramps: number;
}

/** An estimated next period and the fertile window before it. */
export interface CyclePrediction {
  start: string;
  end: string;
  fertileStart: string;
  fertileEnd: string;
  ovulation: string;
}

/** Everything the Cycle screen shows (`getCycle`). Predictions are an average-cycle estimate, not medical advice. */
export interface CycleOverview {
  /** Today, local `YYYY-MM-DD`. */
  today: string;
  enabled: boolean;
  periods: CyclePeriod[];
  /** Days with logged flow or cramps in the last 120 days. */
  days: CycleDay[];
  predictions: CyclePrediction[];
  averageCycleDays: number;
  averagePeriodDays: number;
  periodOngoing: boolean;
  /** Days the next period is late; 0 when it is not. */
  daysLate: number;
  switches: CycleSwitches;
  watchConnected: boolean;
  /** The connected watch lists the menstrual service. */
  watchSupported: boolean;
  watchNote: string;
  /** The watch reports ExpandCapability 265, so the easy-pregnancy switch is sent. */
  easyPregnancySwitch: boolean;
}

/** What the last satellite-data (A-GPS) attempt came to; the strings are the native `AgpsOutcome` codes. */
export type AgpsOutcome =
  | 'none'
  /** The watch pulled the whole file and closed the transfer. */
  | 'delivered'
  /** Downloaded to the phone while no watch was connected; goes out when the watch asks. */
  | 'stored'
  /** The watch did not answer the phone's question, or never came to fetch what was ready. */
  | 'watch_silent'
  | 'no_network'
  | 'download_failed'
  | 'invalid_file'
  /** The watch asked for a kind of data only the watch maker's own app prepares; it was answered "failed". */
  | 'unsupported'
  | 'watch_refused'
  | 'timeout'
  | 'cancelled'
  | 'busy'
  | 'link_lost';

/** What is happening right now: nothing, asking the watch, downloading, ready and waiting for the watch, or sending. */
export type AgpsPhase = 'idle' | 'asking' | 'downloading' | 'waiting' | 'sending';

/** The satellite-data row of the Watch tab (`getAgps`). Times are unix milliseconds, 0 when never. */
export interface AgpsStatus {
  /** A watch is connected now. */
  linked: boolean;
  phase: AgpsPhase;
  /** The newest download on the phone. */
  cachedAt: number;
  cachedSize: number;
  cachedSource: string;
  /** The last delivery to the watch being looked at. */
  deliveredAt: number;
  deliveredSize: number;
  deliveredSource: string;
  /** When the delivered data stops being good (7 days after it was made). */
  expiresAt: number;
  /** The last time the watch asked for data, the download version it named (-1: never) and the names of the kinds it wants. */
  lastAskAt: number;
  lastAskVersion: number;
  lastAskTags: string;
  outcome: AgpsOutcome;
  /** Why the last attempt did not deliver; empty when it did. */
  error: string;
  attemptAt: number;
  /** An automatic retry is not allowed before this time; 0 when nothing waits. */
  retryAt: number;
  failures: number;
  /** The experimental switch (`setAgpsLab`): JoyoFit's HW_AGNSS file is served to a watch that asks for exactly that kind. Absent on older binaries. */
  labAgnss?: boolean;
}

/** What `refreshAgps` came to. */
export interface AgpsRefreshResult {
  outcome: AgpsOutcome;
  message: string;
}
