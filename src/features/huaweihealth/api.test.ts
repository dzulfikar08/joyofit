import { describe, expect, it } from 'bun:test';

import { DEFAULT_HOST, HealthKitClient, HealthKitHttpError, isHealthKitHost } from './api';

type Seen = { url: string; method: string; headers: Record<string, string>; body: unknown };

function client(answer: (url: URL, seen: Seen[]) => Response, host?: string) {
  const seen: Seen[] = [];
  const hosts: string[] = [];
  const c = new HealthKitClient({
    token: async () => ({ accessToken: 'AT', clientId: '123456789' }),
    version: 'and_joyofit_1.0.0',
    host,
    onHost: (h) => hosts.push(h),
    fetch: (async (input: string, init: RequestInit) => {
      seen.push({ url: input, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null });
      return answer(new URL(input), seen);
    }) as unknown as typeof fetch,
  });
  return { c, seen, hosts };
}

const SITE_CROSS = { error: { code: 121001, message: 'request forbidden due to site cross' } };

describe('HealthKitClient', () => {
  it('sends the documented headers and request body for step details', async () => {
    const { c, seen } = client(() => Response.json({ group: [] }));
    await c.stepDetails(1590700295000, 1591018695000);
    expect(seen[0]!.url).toBe(`${DEFAULT_HOST}/healthkit/v2/sampleSet:polymerize`);
    expect(seen[0]!.method).toBe('POST');
    expect(seen[0]!.headers).toMatchObject({ Authorization: 'Bearer AT', 'x-client-id': '123456789', 'x-version': 'and_joyofit_1.0.0' });
    expect(seen[0]!.headers['x-caller-trace-id']).toBeTruthy();
    expect(seen[0]!.body).toEqual({ polymerizeWith: [{ dataTypeName: 'com.huawei.continuous.steps.delta' }], startTime: 1590700295000, endTime: 1591018695000 });
  });

  it('asks for daily totals with day strings and the time zone', async () => {
    const { c, seen } = client(() => Response.json({ group: [] }));
    await c.dailySteps('20200811', '20200812', '+0800');
    expect(seen[0]!.url).toBe(`${DEFAULT_HOST}/healthkit/v2/sampleSet:dailyPolymerize`);
    expect(seen[0]!.body).toEqual({ dataTypes: ['com.huawei.continuous.steps.delta'], startDay: '20200811', endDay: '20200812', timeZone: '+0800' });
  });

  it('repeats a 403 / 121001 request at the Location host once and remembers it', async () => {
    const { c, seen, hosts } = client((url) =>
      url.hostname === 'health-api.cloud.huawei.com'
        ? Response.json(SITE_CROSS, { status: 403, headers: { location: 'https://health-api.cloud.huawei.eu/healthkit/v2/sampleSet:polymerize' } })
        : Response.json({ group: [{ startTime: 1, endTime: 2, sampleSet: [] }] }),
    );
    expect(await c.stepDetails(1, 2)).toHaveLength(1);
    expect(seen.map((s) => s.url)).toEqual([
      'https://health-api.cloud.huawei.com/healthkit/v2/sampleSet:polymerize',
      'https://health-api.cloud.huawei.eu/healthkit/v2/sampleSet:polymerize',
    ]);
    expect(seen[1]!.body).toEqual(seen[0]!.body);
    expect(hosts).toEqual(['https://health-api.cloud.huawei.eu']);
    expect(c.currentHost).toBe('https://health-api.cloud.huawei.eu');
    await c.dailySteps('20200811', '20200812', '+0800');
    expect(seen[2]!.url.startsWith('https://health-api.cloud.huawei.eu/')).toBe(true);
  });

  it('never sends the token to a Location that is not a Health Kit host', async () => {
    const { c, seen } = client(() => Response.json(SITE_CROSS, { status: 403, headers: { location: 'https://evil.example/healthkit/v2/x' } }));
    const error = await c.stepDetails(1, 2).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HealthKitHttpError);
    expect((error as HealthKitHttpError).code).toBe(121001);
    expect(seen).toHaveLength(1);
  });

  it('pages exercise records by cursor, repeating the detail types', async () => {
    const { c, seen } = client((url) =>
      url.searchParams.get('cursor')
        ? Response.json({ activityRecord: [{ id: 'b' }], hasMoreData: false })
        : Response.json({ activityRecord: [{ id: 'a' }], deletedActivityRecord: [{ id: 'x' }], hasMoreData: true, cursor: 'c/1' }),
    );
    const records = await c.activityRecords(1000, 2000, ['com.huawei.instantaneous.exercise_heart_rate', 'com.huawei.instantaneous.location.sample']);
    expect(records.map((r) => r.id)).toEqual(['a', 'b']);
    expect(seen[0]!.url).toBe(
      `${DEFAULT_HOST}/healthkit/v2/activityRecords?startTime=1000&endTime=2000&detailDataType=com.huawei.instantaneous.exercise_heart_rate&detailDataType=com.huawei.instantaneous.location.sample`,
    );
    expect(seen[1]!.url).toBe(
      `${DEFAULT_HOST}/healthkit/v2/activityRecords?cursor=c%2F1&detailDataType=com.huawei.instantaneous.exercise_heart_rate&detailDataType=com.huawei.instantaneous.location.sample`,
    );
  });

  it('ignores a remembered host that is not a Health Kit host', () => {
    expect(client(() => Response.json({}), 'https://evil.example').c.currentHost).toBe(DEFAULT_HOST);
    expect(isHealthKitHost('https://health-api.cloud.huawei.asia')).toBe(true);
    expect(isHealthKitHost('https://health-api.cloud.huawei.com.evil.example')).toBe(false);
  });
});
