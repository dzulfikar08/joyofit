import { describe, expect, test, vi } from 'bun:test';

import type { FetchLike } from './http';
import {
  createRoutingClient,
  parseRouteResponse,
  parseViaResponse,
  routeCacheKey,
  routeUrl,
  routeViaCacheKey,
  routeViaUrl,
} from './routingClient';
import { rejectionOf } from './testSupport';
import { createThrottle } from './throttle';

const A = { lat: -7.98, lon: 112.63 };
const B = { lat: -7.97, lon: 112.64 };

const ok = {
  code: 'Ok',
  routes: [{ geometry: { type: 'LineString', coordinates: [[112.63, -7.98], [112.635, -7.975], [112.64, -7.97]] } }],
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('routeUrl', () => {
  test('is the FOSSGIS URL of the profile, longitude first, with the "driving" path word', () => {
    expect(routeUrl('foot', A, B)).toBe(
      'https://routing.openstreetmap.de/routed-foot/route/v1/driving/112.63,-7.98;112.64,-7.97?overview=full&geometries=geojson',
    );
    expect(routeUrl('bike', A, B)).toContain('/routed-bike/route/v1/driving/');
  });
});

describe('routeViaUrl', () => {
  test('lists every waypoint in order, longitude first, in one request', () => {
    const C = { lat: -7.96, lon: 112.65 };
    expect(routeViaUrl('foot', [A, B, C, A])).toBe(
      'https://routing.openstreetmap.de/routed-foot/route/v1/driving/112.63,-7.98;112.64,-7.97;112.65,-7.96;112.63,-7.98?overview=full&geometries=geojson',
    );
    expect(routeViaUrl('foot', [A, B])).toBe(routeUrl('foot', A, B));
  });

  test('the cache key keeps the order of the waypoints and agrees with the two-point key', () => {
    expect(routeViaCacheKey('foot', [A, B])).toBe(routeCacheKey('foot', A, B));
    expect(routeViaCacheKey('foot', [A, B, A])).not.toBe(routeViaCacheKey('foot', [A, A, B]));
  });
});

describe('parseViaResponse', () => {
  test('reads the line and how far each waypoint had to move to reach a road', () => {
    const answer = parseViaResponse({ ...ok, waypoints: [{ distance: 3.2 }, { distance: 12 }, { distance: 0 }] });
    expect(answer.line).toHaveLength(3);
    expect(answer.snapM).toEqual([3.2, 12, 0]);
  });

  test('an answer without usable waypoints has no snap distances, not wrong ones', () => {
    expect(parseViaResponse(ok).snapM).toEqual([]);
    expect(parseViaResponse({ ...ok, waypoints: [{ distance: 1 }, {}] }).snapM).toEqual([]);
  });

  test('a failure is still a failure', () => {
    expect(() => parseViaResponse({ code: 'NoRoute', routes: [] })).toThrow(expect.objectContaining({ kind: 'code' }));
  });
});

describe('routeCacheKey', () => {
  test('rounds to 5 decimals and separates profiles', () => {
    const near = { lat: A.lat + 0.000001, lon: A.lon - 0.000001 };
    expect(routeCacheKey('foot', A, B)).toBe(routeCacheKey('foot', near, B));
    expect(routeCacheKey('foot', A, B)).not.toBe(routeCacheKey('bike', A, B));
    expect(routeCacheKey('foot', A, B)).not.toBe(routeCacheKey('foot', B, A));
  });
});

describe('parseRouteResponse', () => {
  test('reads routes[0].geometry.coordinates as lat/lon', () => {
    expect(parseRouteResponse(ok)).toEqual([
      { lat: -7.98, lon: 112.63 },
      { lat: -7.975, lon: 112.635 },
      { lat: -7.97, lon: 112.64 },
    ]);
  });

  test('a code other than Ok is a code error', () => {
    expect(() => parseRouteResponse({ code: 'NoRoute', routes: [] })).toThrow(
      expect.objectContaining({ kind: 'code' }),
    );
  });

  test('anything else that is not a line is a parse error', () => {
    for (const body of [
      null,
      'x',
      { code: 'Ok' },
      { code: 'Ok', routes: [] },
      { code: 'Ok', routes: [{ geometry: { coordinates: [[1, 2]] } }] },
      { code: 'Ok', routes: [{ geometry: { coordinates: [[1, 2], ['a', 'b']] } }] },
      { code: 'Ok', routes: [{ geometry: { coordinates: [[1, 2], [500, 2]] } }] },
    ]) {
      expect(() => parseRouteResponse(body)).toThrow(expect.objectContaining({ kind: 'parse' }));
    }
  });
});

describe('createRoutingClient', () => {
  function setup(respond: FetchLike) {
    let time = 0;
    const calls: { url: string; headers: Record<string, string>; at: number }[] = [];
    const fetch: FetchLike = (url, init) => {
      calls.push({ url, headers: init.headers, at: time });
      return respond(url, init);
    };
    const throttle = createThrottle({
      minIntervalMs: 1100,
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
    });
    const client = createRoutingClient({
      fetch,
      userAgent: 'JoyoFit/1.0 (https://joyofit.app)',
      referer: 'https://joyofit.app',
      throttle,
      timeoutMs: 30,
    });
    return { client, calls };
  }

  test('sends the identifying headers and returns the snapped line', async () => {
    const { client, calls } = setup(async () => jsonResponse(ok));
    const line = await client.route('foot', A, B);
    expect(line).toHaveLength(3);
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['User-Agent']).toBe('JoyoFit/1.0 (https://joyofit.app)');
    expect(calls[0].headers.Referer).toBe('https://joyofit.app');
  });

  test('keeps requests 1.1 s apart', async () => {
    const { client, calls } = setup(async () => jsonResponse(ok));
    const points = [A, B, { lat: -7.96, lon: 112.65 }, { lat: -7.95, lon: 112.66 }];
    await Promise.all(points.slice(1).map((to, i) => client.route('foot', points[i], to)));
    expect(calls.map((c) => c.at)).toEqual([0, 1100, 2200]);
  });

  test('answers a repeated leg from the cache without a request', async () => {
    const { client, calls } = setup(async () => jsonResponse(ok));
    const first = await client.route('foot', A, B);
    const second = await client.route('foot', { lat: A.lat + 0.000001, lon: A.lon }, B);
    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
    await client.route('bike', A, B);
    expect(calls).toHaveLength(2);
  });

  test('routeVia goes through one request, carries the snap distances and shares the cache with route', async () => {
    const C = { lat: -7.96, lon: 112.65 };
    const { client, calls } = setup(async () => jsonResponse({ ...ok, waypoints: [{ distance: 2 }, { distance: 9 }, { distance: 1 }] }));
    const via = await client.routeVia('foot', [A, B, C]);
    expect(via.snapM).toEqual([2, 9, 1]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('112.63,-7.98;112.64,-7.97;112.65,-7.96');
    expect(await client.routeVia('foot', [A, B, C])).toBe(via);
    expect(calls).toHaveLength(1);
    await client.route('foot', A, B);
    expect(calls).toHaveLength(2);
    await client.route('foot', A, B);
    expect(calls).toHaveLength(2);
  });

  test('does not cache a failure', async () => {
    let fail = true;
    const { client, calls } = setup(async () => (fail ? jsonResponse({}, 429) : jsonResponse(ok)));
    await expect(client.route('foot', A, B)).rejects.toMatchObject({ kind: 'http', status: 429 });
    fail = false;
    expect(await client.route('foot', A, B)).toHaveLength(3);
    expect(calls).toHaveLength(2);
  });

  test('NoRoute from the service is a code error', async () => {
    const { client } = setup(async () => jsonResponse({ code: 'NoRoute', routes: [] }));
    await expect(client.route('foot', A, B)).rejects.toMatchObject({ kind: 'code' });
  });

  test('a network failure is a network error', async () => {
    const { client } = setup(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(client.route('foot', A, B)).rejects.toMatchObject({ kind: 'network' });
  });

  test('gives up after the timeout, even for a fetch that ignores the abort signal', async () => {
    vi.useFakeTimers();
    try {
      const started = Promise.withResolvers<void>();
      const { client } = setup(() => {
        started.resolve();
        return new Promise(() => {});
      });
      const rejection = rejectionOf(client.route('foot', A, B));
      await started.promise;
      vi.advanceTimersByTime(30);
      expect(await rejection).toMatchObject({ kind: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  test('an abort rejects with aborted and sends nothing when it comes first', async () => {
    const { client, calls } = setup(async () => jsonResponse(ok));
    const controller = new AbortController();
    controller.abort();
    await expect(client.route('foot', A, B, controller.signal)).rejects.toMatchObject({ kind: 'aborted' });
    expect(calls).toHaveLength(0);
  });

  test('an abort during the request rejects with aborted', async () => {
    const started = Promise.withResolvers<void>();
    const { client } = setup(() => {
      started.resolve();
      return new Promise(() => {});
    });
    const controller = new AbortController();
    const rejection = rejectionOf(client.route('foot', A, B, controller.signal));
    await started.promise;
    controller.abort();
    expect(await rejection).toMatchObject({ kind: 'aborted' });
  });
});
