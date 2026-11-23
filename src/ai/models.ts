/**
 * Single source of truth for the AI models the UI can pick from.
 * Kept free of server-only imports so client components can use it.
 */
export interface ModelOption {
  id: string;
  label: string;
  /** Short name used in progress messages. */
  shortName: string;
  /** Tailwind classes for the model's badge in the review screen. */
  badgeClass: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: "openai/gpt-5.5",
    label: "GPT-5.5",
    shortName: "ChatGPT",
    badgeClass: "bg-amber-50 text-amber-600 border-amber-100",
  },
  {
    id: "googleai/gemini-3.6-flash",
    label: "Gemini 3.6",
    shortName: "Gemini",
    badgeClass: "bg-blue-50 text-blue-600 border-blue-100",
  },
];

export const DEFAULT_MODEL_ID = "googleai/gemini-3.6-flash";

export function getModelOption(id: string | undefined): ModelOption | undefined {
  if (!id) return undefined;
  return (
    AVAILABLE_MODELS.find((m) => m.id === id) ??
    // Older saved tests reference retired model ids (e.g. "openai/gpt-4o"); match by provider.
    AVAILABLE_MODELS.find((m) => m.id.split("/")[0] === id.split("/")[0])
  );
}
