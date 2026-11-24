"use client";

import { AVAILABLE_MODELS } from "@/ai/models";
import { Textarea } from "@/components/ui/textarea";
import { SETTINGS, type SettingKey } from "@/lib/settings/registry";

interface SettingFieldProps {
  settingKey: SettingKey;
  value: unknown;
  disabled?: boolean;
  onChange: (value: unknown) => void;
}

/** The input for one registry setting, chosen by its `input.kind`. */
export function SettingField({ settingKey, value, disabled, onChange }: SettingFieldProps) {
  const def = SETTINGS[settingKey];
  const id = `setting-${settingKey.replace(/\./g, "-")}`;
  const input = def.input;

  switch (input.kind) {
    case "boolean":
      return (
        <label htmlFor={id} className="flex items-start gap-3 cursor-pointer">
          <input
            id={id}
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
            checked={value === true}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">{def.label}</span>
            <span className="block text-xs text-muted-foreground">{def.help}</span>
          </span>
        </label>
      );
    case "select":
      return (
        <div className="space-y-1.5">
          <label htmlFor={id} className="block text-sm font-medium text-slate-800">
            {def.label}
          </label>
          <select
            id={id}
            className="w-full sm:w-64 h-10 px-3 rounded-md border border-input bg-white text-sm disabled:opacity-60"
            value={String(value)}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          >
            {input.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{def.help}</p>
        </div>
      );
    case "text":
      return (
        <div className="space-y-1.5">
          <label htmlFor={id} className="block text-sm font-medium text-slate-800">
            {def.label}
          </label>
          <Textarea
            id={id}
            className="text-sm min-h-[80px] bg-white"
            value={String(value ?? "")}
            maxLength={input.maxLength}
            placeholder={input.placeholder}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{def.help}</p>
        </div>
      );
    case "models": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className="space-y-1.5" disabled={disabled}>
          <legend className="text-sm font-medium text-slate-800">{def.label}</legend>
          <div className="flex flex-wrap gap-4">
            {AVAILABLE_MODELS.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selected.includes(m.id)}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...selected, m.id] : selected.filter((id) => id !== m.id))
                  }
                />
                {m.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{def.help}</p>
        </fieldset>
      );
    }
  }
}
