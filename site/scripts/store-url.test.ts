import { describe, expect, test } from "bun:test";

import { PLAY_STORE_URL, playStoreUrl } from "../src/lib.ts";

describe("playStoreUrl", () => {
  test("default carries the evergreen site campaign in the referrer", () => {
    expect(PLAY_STORE_URL).toBe(
      "https://play.google.com/store/apps/details?id=com.joyodigitama.joyofit&referrer=utm_source%3Djoyofit%26utm_medium%3Dreferral%26utm_campaign%3Devergreen-site",
    );
  });

  test("a place ends the campaign", () => {
    expect(playStoreUrl("Hero")).toContain("utm_campaign%3Devergreen-site-hero");
  });
});
