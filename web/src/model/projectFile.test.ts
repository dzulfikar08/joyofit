import { describe, expect, it } from "vitest";
import { emptyProject } from "./defaults";
import { assetIdsOf, parseProjectFile, restoreProject, ProjectFileError, serializeProject } from "./projectFile";
import { DEFAULT_SCREEN, presetById, presetScreen } from "./screens";

describe("project file", () => {
  it("round-trips a project", async () => {
    const project = emptyProject("Round trip");
    const parsed = await parseProjectFile(await serializeProject(project));
    expect(parsed).toEqual(project);
  });

  it("opens a project saved before screens existed as a Watch Fit 4 face, unchanged", async () => {
    const { screen: _screen, ...old } = emptyProject("Old");
    const file = JSON.stringify({ format: "joyofit-studio-project", project: old, assets: {} });
    const parsed = await parseProjectFile(file);
    expect(parsed.screen).toEqual(DEFAULT_SCREEN);
    expect(parsed.elements).toEqual(old.elements);
    expect(restoreProject(old).screen).toEqual(DEFAULT_SCREEN);
  });

  it("keeps a preset and a custom screen through a save and open", async () => {
    const band = emptyProject("Band", presetScreen(presetById("band194")!));
    expect((await parseProjectFile(await serializeProject(band))).screen).toEqual(band.screen);
    const custom = emptyProject("Custom", { presetId: null, width: 300, height: 300, shape: "squircle", cornerRadius: 70 });
    expect(await parseProjectFile(await serializeProject(custom))).toEqual(custom);
  });

  it("reads a screen that does not make sense as the Watch Fit 4", () => {
    const project = { ...emptyProject(), screen: { presetId: null, width: "wide", height: 10, shape: "oval" } };
    expect(restoreProject(project).screen).toEqual(DEFAULT_SCREEN);
  });

  it("rejects files that are not projects", async () => {
    await expect(parseProjectFile("not json")).rejects.toBeInstanceOf(ProjectFileError);
    await expect(parseProjectFile(JSON.stringify({ hello: 1 }))).rejects.toThrow(/not a JoyoFit Studio project/);
    const file = JSON.parse(await serializeProject(emptyProject()));
    file.project.version = 99;
    await expect(parseProjectFile(JSON.stringify(file))).rejects.toThrow(/version 99/);
    file.project.version = 1;
    file.project.elements = [{ nope: true }];
    await expect(parseProjectFile(JSON.stringify(file))).rejects.toThrow(/damaged/);
  });

  it("lists the assets a project uses", () => {
    const p = emptyProject();
    p.elements[0] = { ...p.elements[0]!, fill: { kind: "image", assetId: "photo", zoom: 1, offsetX: 0, offsetY: 0, dim: 0 } } as never;
    expect(assetIdsOf(p)).toEqual(["photo"]);
  });
});
