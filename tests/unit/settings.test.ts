import { describe, expect, it } from "vitest";
import { AVAILABLE_MODELS } from "@/ai/models";
import { lockedKeys, resolveAll, resolveSetting, validateSettingsPatch } from "@/lib/settings/resolve";
import { SETTINGS } from "@/lib/settings/registry";

describe("resolveSetting", () => {
  it("falls back to the registry default", () => {
    expect(resolveSetting("assistants.canEdit", undefined)).toEqual({ value: false, source: "default", locked: false });
    expect(resolveSetting("generation.allowedModels", {}).value).toEqual(AVAILABLE_MODELS.map((m) => m.id));
  });

  it("uses the org value, then the course value", () => {
    const org = { values: { "generation.defaultDifficulty": "hard" } };
    expect(resolveSetting("generation.defaultDifficulty", org)).toMatchObject({ value: "hard", source: "org" });
    const course = { values: { "generation.defaultDifficulty": "easy" } };
    expect(resolveSetting("generation.defaultDifficulty", org, course)).toMatchObject({ value: "easy", source: "course" });
  });

  it("ignores course values for org-only settings", () => {
    const course = { values: { "courses.instructorsCanCreate": false } };
    expect(resolveSetting("courses.instructorsCanCreate", {}, course)).toMatchObject({ value: true, source: "default" });
  });

  it("ignores the course value when the org locked the setting", () => {
    const org = { values: { "assistants.canEdit": false }, locked: ["assistants.canEdit"] };
    const course = { values: { "assistants.canEdit": true } };
    expect(resolveSetting("assistants.canEdit", org, course)).toEqual({ value: false, source: "org", locked: true });
  });

  it("locks a setting even if the org never set a value", () => {
    const course = { values: { "assistants.canEdit": true } };
    expect(resolveSetting("assistants.canEdit", { locked: ["assistants.canEdit"] }, course)).toEqual({
      value: false,
      source: "default",
      locked: true,
    });
  });

  it("ignores stored values that no longer validate", () => {
    const org = { values: { "generation.allowedModels": ["retired/model"], "generation.defaultDifficulty": 3 } };
    expect(resolveSetting("generation.allowedModels", org).source).toBe("default");
    expect(resolveSetting("generation.defaultDifficulty", org).source).toBe("default");
  });

  it("resolves every registered setting", () => {
    expect(Object.keys(resolveAll(undefined)).sort()).toEqual(Object.keys(SETTINGS).sort());
  });
});

describe("lockedKeys", () => {
  it("keeps only known, lockable keys", () => {
    expect([...lockedKeys({ locked: ["assistants.canEdit", "generation.allowedModels", "nope", 5] })]).toEqual([
      "assistants.canEdit",
    ]);
    expect(lockedKeys({ locked: "assistants.canEdit" }).size).toBe(0);
  });
});

describe("validateSettingsPatch", () => {
  it("accepts valid values and clears nulls", () => {
    expect(
      validateSettingsPatch("org", { values: { "generation.defaultDifficulty": "hard", "assistants.canEdit": null }, locked: ["assistants.canEdit"] })
    ).toEqual({ set: { "generation.defaultDifficulty": "hard" }, clear: ["assistants.canEdit"], locked: ["assistants.canEdit"] });
  });

  it("trims text values", () => {
    expect(validateSettingsPatch("org", { values: { "generation.orgInstructions": "  Use Spanish.  " } }).set).toEqual({
      "generation.orgInstructions": "Use Spanish.",
    });
  });

  it.each([
    ["unknown keys", "org", { values: { "made.up": 1 } }, /Unknown setting/],
    ["wrong scope", "course", { values: { "generation.allowedModels": [AVAILABLE_MODELS[0].id] } }, /can't be set on a course/],
    ["invalid values", "org", { values: { "generation.defaultDifficulty": "brutal" } }, /Default difficulty/],
    ["empty model list", "org", { values: { "generation.allowedModels": [] } }, /at least one model/],
    ["unlockable keys", "org", { values: {}, locked: ["generation.allowedModels"] }, /can't be locked/],
    ["locks on courses", "course", { values: {}, locked: [] }, /Only organizations/],
  ] as const)("rejects %s", (_name, scope, patch, message) => {
    expect(() => validateSettingsPatch(scope, patch as never)).toThrow(message);
  });

  it("rejects course changes to settings the org locked", () => {
    expect(() =>
      validateSettingsPatch("course", { values: { "assistants.canEdit": true } }, new Set(["assistants.canEdit"]))
    ).toThrow(/set by your organization/);
  });
});
