import { describe, expect, test } from "bun:test";

import { FALLBACK_PRICE, fetchJoyoPrice, fetchLivePrice, priceFromConfig } from "../src/joyo-price.ts";

describe("priceFromConfig", () => {
  test("formats the current ladder step from /api/config", () => {
    expect(
      priceFromConfig({
        founderPriceIdr: 29000,
        founderYearlyPriceIdr: 199000,
        promo: { slots: 60, nextPriceIdr: 49000 },
      }),
    ).toEqual({ monthly: "Rp29.000", yearly: "Rp199.000", yearlyPerMonth: "Rp16.583", next: "Rp49.000", slots: 60 });
  });

  test("last step: no next price and no slot count", () => {
    expect(priceFromConfig({ founderPriceIdr: 49000, founderYearlyPriceIdr: 349000, promo: null })).toEqual({
      monthly: "Rp49.000",
      yearly: "Rp349.000",
      yearlyPerMonth: "Rp29.083",
      next: null,
      slots: null,
    });
  });

  test("rejects a response without prices", () => {
    expect(priceFromConfig({})).toBeNull();
    expect(priceFromConfig({ founderPriceIdr: "29000", founderYearlyPriceIdr: 199000 })).toBeNull();
  });
});

describe("fetchJoyoPrice", () => {
  test("falls back when the API fails", async () => {
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchJoyoPrice("https://example.invalid", failing)).toEqual(FALLBACK_PRICE);
  });

  test("falls back on a non-OK response", async () => {
    const notOk = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    expect(await fetchJoyoPrice("https://example.invalid", notOk)).toEqual(FALLBACK_PRICE);
  });
});

describe("fetchLivePrice", () => {
  test("null when the browser cannot read the API, so the page keeps the build's price", async () => {
    const refused = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await fetchLivePrice("https://api.example/api/config", refused)).toBeNull();
  });

  test("the live price when the API answers", async () => {
    const ok = (async () =>
      Response.json({ founderPriceIdr: 49000, founderYearlyPriceIdr: 349000, promo: null })) as unknown as typeof fetch;
    expect((await fetchLivePrice("https://api.example/api/config", ok))?.monthly).toBe("Rp49.000");
  });
});
