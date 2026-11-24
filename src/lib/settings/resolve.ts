import { isSettingKey, SETTING_KEYS, SETTINGS, type SettingKey, type SettingScope, type SettingValues } from "./registry";

/** Settings as stored on an org or course document. */
export interface StoredSettings {
  values?: Record<string, unknown>;
  locked?: unknown;
}

export type SettingSource = "default" | "org" | "course";

export interface ResolvedSetting<K extends SettingKey = SettingKey> {
  value: SettingValues[K];
  source: SettingSource;
  /** The org locked this setting, so courses can't override it. */
  locked: boolean;
}

function storedValue(key: SettingKey, stored: StoredSettings | undefined): { ok: true; value: unknown } | { ok: false } {
  const values = stored?.values;
  if (!values || !Object.prototype.hasOwnProperty.call(values, key)) return { ok: false };
  // A value that no longer validates (e.g. a retired model) is ignored rather than trusted.
  const parsed = SETTINGS[key].schema.safeParse(values[key]);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

export function lockedKeys(org: StoredSettings | undefined): Set<SettingKey> {
  const locked = Array.isArray(org?.locked) ? org.locked : [];
  return new Set(locked.filter((k): k is SettingKey => typeof k === "string" && isSettingKey(k) && SETTINGS[k].lockable));
}

/** Registry default → org value → course value (unless the org locked the key). */
export function resolveSetting<K extends SettingKey>(
  key: K,
  org: StoredSettings | undefined,
  course?: StoredSettings
): ResolvedSetting<K> {
  const def = SETTINGS[key];
  const locked = lockedKeys(org).has(key);
  if (course && def.scopes.includes("course") && !locked) {
    const v = storedValue(key, course);
    if (v.ok) return { value: v.value as SettingValues[K], source: "course", locked };
  }
  if (def.scopes.includes("org")) {
    const v = storedValue(key, org);
    if (v.ok) return { value: v.value as SettingValues[K], source: "org", locked };
  }
  return { value: def.default as SettingValues[K], source: "default", locked };
}

export function resolveAll(org: StoredSettings | undefined, course?: StoredSettings): { [K in SettingKey]: ResolvedSetting<K> } {
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, resolveSetting(k, org, course)])) as {
    [K in SettingKey]: ResolvedSetting<K>;
  };
}

export interface SettingsPatch {
  /** New values; `null` removes the value so it inherits again. */
  values: Record<string, unknown>;
  /** Org only: the complete new list of locked keys. */
  locked?: string[];
}

export interface ValidatedPatch {
  set: Partial<Record<SettingKey, unknown>>;
  clear: SettingKey[];
  locked?: SettingKey[];
}

/**
 * Validate a settings change for one scope. Throws an Error with a user-facing message.
 * `lockedByOrg` is required for course patches: locked settings can't be changed there.
 */
export function validateSettingsPatch(scope: SettingScope, patch: SettingsPatch, lockedByOrg: Set<SettingKey> = new Set()): ValidatedPatch {
  const out: ValidatedPatch = { set: {}, clear: [] };
  for (const [key, raw] of Object.entries(patch.values ?? {})) {
    if (!isSettingKey(key)) throw new Error(`Unknown setting "${key}".`);
    const def = SETTINGS[key];
    if (!def.scopes.includes(scope)) throw new Error(`"${def.label}" can't be set on a ${scope === "org" ? "organization" : "course"}.`);
    if (scope === "course" && lockedByOrg.has(key)) throw new Error(`"${def.label}" is set by your organization.`);
    if (raw === null) {
      out.clear.push(key);
      continue;
    }
    const parsed = def.schema.safeParse(raw);
    if (!parsed.success) throw new Error(`${def.label}: ${parsed.error.issues[0]?.message ?? "invalid value"}`);
    out.set[key] = parsed.data;
  }
  if (patch.locked !== undefined) {
    if (scope !== "org") throw new Error("Only organizations can lock settings.");
    const locked = new Set<SettingKey>();
    for (const key of patch.locked) {
      if (!isSettingKey(key) || !SETTINGS[key].lockable) throw new Error(`"${key}" can't be locked.`);
      locked.add(key);
    }
    out.locked = [...locked];
  }
  return out;
}
