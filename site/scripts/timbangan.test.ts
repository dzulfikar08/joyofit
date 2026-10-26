import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PROTOCOLS } from "../../src/features/scale/registry";
import { build, render } from "./timbangan";

test("every protocol in the app's registry is on the page exactly once", () => {
  const listed = build().flatMap((family) => family.items.map((item) => item.nama));
  expect(listed).toHaveLength(PROTOCOLS.length);
});

test("src/timbangan.ts is what the registry generates", () => {
  const committed = readFileSync(new URL("../src/timbangan.ts", import.meta.url), "utf8");
  expect(committed).toBe(render());
});

test("the Tuya beacon scale is listed as weight only, needing a key, and tried on a real scale; nothing else is marked tried", () => {
  const items = build().flatMap((family) => family.items);
  const tuya = items.find((item) => item.nama === "Tuya beacon");
  expect(tuya).toMatchObject({ data: "berat", teruji: true, butuhKunci: true });
  expect(items.filter((item) => item.teruji).map((item) => item.nama)).toEqual(["Tuya beacon"]);
  expect(items.filter((item) => item.butuhKunci).map((item) => item.nama)).toEqual(["Tuya beacon", "HUAWEI Scale 2 Pro / 3 / 3 Pro"]);
});

test("the Huawei Hagrid scales are listed as needing keys and not tried on a real scale", () => {
  const hagrid = build()
    .flatMap((family) => family.items)
    .find((item) => item.nama === "HUAWEI Scale 2 Pro / 3 / 3 Pro");
  expect(hagrid).toMatchObject({ data: "timbangan", butuhKunci: true });
  expect(hagrid?.teruji).toBeUndefined();
});
