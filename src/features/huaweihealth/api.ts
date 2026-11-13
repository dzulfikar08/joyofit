/**
 * Health Kit cloud REST calls made from the phone (docs/huawei-health-kit.md "Sync from the cloud API"), with the one-hour
 * access token the Worker hands out. Only the three documented read endpoints the sync needs:
 *
 * - `GET  /healthkit/v2/activityRecords`            exercise records with their details (31 days per call, cursor paging)
 * - `POST /healthkit/v2/sampleSet:polymerize`       step details (30 days per call)
 * - `POST /healthkit/v2/sampleSet:dailyPolymerize`  step totals per calendar day (31 days per call)
 *
 * A user registered on another Huawei site is answered 403 with error 121001 and the right host in `Location`; the request
 * is repeated there once and the host is remembered for the next calls. No Expo imports: `fetch` is injected in tests.
 */
import type { HkActivityRecord, HkGroup } from './mapping';

/** Huawei's default Health Kit host; every documented example uses it. */
export const DEFAULT_HOST = 'https://health-api.cloud.huawei.com';

export interface HealthKitToken {
  accessToken: string;
  /** The HUAWEI ID App ID, sent as `x-client-id` (Huawei recommends it for routing). */
  clientId: string;
}

export interface HealthKitClientOptions {
  token: () => Promise<HealthKitToken>;
  /** `x-version`, Huawei's "OS_App type_Version" (for example `and_joyofit_1.4.0`). */
  version: string;
  /** The host remembered from an earlier cross-site answer; the default host otherwise. */
  host?: string;
  /** Called when a cross-site answer moved the user to another host. */
  onHost?: (host: string) => void;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Health Kit answered with an error status. `code` is Huawei's `error.code` when the body had one. */
export class HealthKitHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'HealthKitHttpError';
  }
}

/**
 * Health Kit's sites: `com` is the documented default, `eu` the FAQ's cross-site example; `asia` and `ru` are Huawei's other
 * cloud sites. A Location naming any other host is refused, so the user's token never leaves Huawei's Health Kit hosts.
 */
const HEALTH_KIT_HOST = /^health-api\.cloud\.huawei\.(com|eu|asia|ru)$/;

/** True for an `https://health-api.cloud.huawei.<site>` URL: the only hosts the user's token is ever sent to. */
export function isHealthKitHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.port === '' && HEALTH_KIT_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

const errorOf = (body: unknown): { code: number | null; message: string | null } => {
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const code = typeof error?.code === 'number' ? error.code : typeof error?.code === 'string' && /^\d+$/.test(error.code) ? Number(error.code) : null;
  return { code, message: typeof error?.message === 'string' ? error.message : null };
};

const traceId = () => `joyofit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export class HealthKitClient {
  private host: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HealthKitClientOptions) {
    this.host = options.host && isHealthKitHost(options.host) ? new URL(options.host).origin : DEFAULT_HOST;
    this.fetchFn = options.fetch ?? fetch;
  }

  get currentHost(): string {
    return this.host;
  }

  private async request<T>(method: 'GET' | 'POST', pathAndQuery: string, body?: unknown): Promise<T> {
    const token = await this.options.token();
    let url = `${this.host}${pathAndQuery}`;
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 60_000);
      let response: Response;
      try {
        response = await this.fetchFn(url, {
          method,
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            Accept: 'application/json',
            Authorization: `Bearer ${token.accessToken}`,
            'x-client-id': token.clientId,
            'x-version': this.options.version,
            'x-caller-trace-id': traceId(),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (response.ok) return (await response.json()) as T;
      const parsed = await response.json().catch(() => null);
      const { code, message } = errorOf(parsed);
      const location = response.headers.get('location');
      // FAQ "How should I deal with the 403 HTTP status code with error code 121001?": repeat at the domain in Location.
      if (response.status === 403 && code === 121001 && location && isHealthKitHost(location) && attempt === 0) {
        url = location;
        this.host = new URL(location).origin;
        this.options.onHost?.(this.host);
        continue;
      }
      throw new HealthKitHttpError(response.status, code, `Health Kit ${response.status}${code ? ` / ${code}` : ''}${message ? `: ${message}` : ''}`);
    }
  }

  /**
   * Every exercise record that falls in [startMs, endMs] (at most 31 days apart), with the given detail types, following
   * `hasMoreData` / `cursor`. Records Huawei lists as deleted are ignored: a deletion in Huawei Health never deletes here.
   */
  async activityRecords(startMs: number, endMs: number, detailTypes: readonly string[]): Promise<HkActivityRecord[]> {
    const details = detailTypes.map((t) => `&detailDataType=${encodeURIComponent(t)}`).join('');
    const out: HkActivityRecord[] = [];
    let query = `startTime=${startMs}&endTime=${endMs}${details}`;
    for (let page = 0; page < 100; page += 1) {
      const answer = await this.request<{ activityRecord?: HkActivityRecord[]; hasMoreData?: boolean; cursor?: string }>(
        'GET',
        `/healthkit/v2/activityRecords?${query}`,
      );
      out.push(...(answer.activityRecord ?? []));
      if (!answer.hasMoreData || !answer.cursor) break;
      query = `cursor=${encodeURIComponent(answer.cursor)}${details}`;
    }
    return out;
  }

  /** Step details (`com.huawei.continuous.steps.delta`) in [startMs, endMs], at most 30 days apart. */
  async stepDetails(startMs: number, endMs: number): Promise<HkGroup[]> {
    const answer = await this.request<{ group?: HkGroup[] }>('POST', '/healthkit/v2/sampleSet:polymerize', {
      polymerizeWith: [{ dataTypeName: 'com.huawei.continuous.steps.delta' }],
      startTime: startMs,
      endTime: endMs,
    });
    return answer.group ?? [];
  }

  /** Step totals per calendar day from `startDay` to `endDay` (`yyyyMMdd`, at most 31 days apart) in `timeZone` (`+0700`). */
  async dailySteps(startDay: string, endDay: string, timeZone: string): Promise<HkGroup[]> {
    const answer = await this.request<{ group?: HkGroup[] }>('POST', '/healthkit/v2/sampleSet:dailyPolymerize', {
      dataTypes: ['com.huawei.continuous.steps.delta'],
      startDay,
      endDay,
      timeZone,
    });
    return answer.group ?? [];
  }
}
