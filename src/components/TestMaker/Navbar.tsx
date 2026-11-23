"use client";

import { GraduationCap, Zap, Cpu, Check, LogOut, type LucideIcon } from "lucide-react";
import { AVAILABLE_MODELS } from "@/ai/models";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";

interface NavbarProps {
  selectedModels: string[];
  onModelsChange: (models: string[]) => void;
  onHome?: () => void;
}

const MODEL_STYLES: Record<string, { icon: LucideIcon; checked: string; iconColor: string }> = {
  openai: { icon: Zap, checked: "bg-amber-500 border-amber-500", iconColor: "text-amber-500" },
  googleai: { icon: Cpu, checked: "bg-blue-500 border-blue-500", iconColor: "text-blue-500" },
};
const FALLBACK_STYLE = { icon: Cpu, checked: "bg-primary border-primary", iconColor: "text-primary" };

export function Navbar({ selectedModels, onModelsChange, onHome }: NavbarProps) {
  const { user, access, signOut } = useAuth();
  const account = access.status === "allowed" ? access.account : null;

  const toggleModel = (model: string) => {
    if (selectedModels.includes(model)) {
      // At least one model must stay selected.
      if (selectedModels.length > 1) {
        onModelsChange(selectedModels.filter((m) => m !== model));
      }
    } else {
      onModelsChange([...selectedModels, model]);
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
        <button type="button" onClick={onHome} className="flex items-center gap-2 group outline-none shrink-0">
          <div className="bg-primary p-2 rounded-lg group-hover:bg-primary/90 transition-colors">
            <GraduationCap className="h-6 w-6 text-white" />
          </div>
          <span className="hidden sm:inline text-xl font-bold tracking-tight text-primary font-headline">TestMaker</span>
        </button>

        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
        {account && (
        <div role="group" aria-label="AI models" className="flex p-1 bg-slate-100 rounded-xl gap-1 border border-slate-200">
          {AVAILABLE_MODELS.map((model) => {
            const selected = selectedModels.includes(model.id);
            const isLastSelected = selected && selectedModels.length === 1;
            const style = MODEL_STYLES[model.id.split("/")[0]] ?? FALLBACK_STYLE;
            const Icon = style.icon;
            return (
              <button
                key={model.id}
                type="button"
                aria-pressed={selected}
                title={isLastSelected ? "At least one model must be selected" : undefined}
                onClick={() => toggleModel(model.id)}
                className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all ${selected ? "bg-white shadow-sm text-primary" : "text-slate-400 hover:text-slate-600"}`}
              >
                <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${selected ? `${style.checked} text-white` : "border-slate-300"}`}>
                  {selected && <Check className="h-2 w-2" />}
                </div>
                <Icon className={`h-3 w-3 ${selected ? style.iconColor : ""}`} />
                {model.label}
              </button>
            );
          })}
        </div>
        )}
        {user && (
          <div className="flex items-center gap-2 min-w-0">
            <div className="hidden md:flex flex-col items-end leading-tight min-w-0">
              <span className="text-xs font-medium text-slate-700 truncate max-w-[180px]" title={user.email ?? undefined}>
                {user.email}
              </span>
              {account && (
                <span className="text-[10px] text-muted-foreground" title="Questions generated today / daily limit">
                  {account.usedToday} / {account.dailyLimit} today
                </span>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out" title="Sign out" className="text-slate-500">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
        </div>
      </div>
    </header>
  );
}
