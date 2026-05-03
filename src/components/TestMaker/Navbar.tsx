"use client";

import { GraduationCap, Zap, Cpu, Check } from "lucide-react";
import Link from "next/link";

interface NavbarProps {
  selectedModels: string[];
  onModelsChange: (models: string[]) => void;
}

export function Navbar({ selectedModels, onModelsChange }: NavbarProps) {
  const toggleModel = (model: string) => {
    if (selectedModels.includes(model)) {
      if (selectedModels.length > 1) {
        onModelsChange(selectedModels.filter(m => m !== model));
      }
    } else {
      onModelsChange([...selectedModels, model]);
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="bg-primary p-2 rounded-lg group-hover:bg-primary/90 transition-colors">
            <GraduationCap className="h-6 w-6 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-primary font-headline">TestMaker</span>
        </Link>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex p-1 bg-slate-100 rounded-xl gap-1 border border-slate-200">
            <button
              onClick={() => toggleModel("openai/gpt-4o")}
              className={`flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all ${selectedModels.includes('openai/gpt-4o') ? 'bg-white shadow-sm text-primary' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${selectedModels.includes('openai/gpt-4o') ? 'bg-amber-500 border-amber-500 text-white' : 'border-slate-300'}`}>
                {selectedModels.includes('openai/gpt-4o') && <Check className="h-2 w-2" />}
              </div>
              <Zap className={`h-3 w-3 ${selectedModels.includes('openai/gpt-4o') ? 'text-amber-500' : ''}`} />
              ChatGPT
            </button>
            <button
              onClick={() => toggleModel("googleai/gemini-2.5-flash")}
              className={`flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all ${selectedModels.includes('googleai/gemini-2.5-flash') ? 'bg-white shadow-sm text-primary' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${selectedModels.includes('googleai/gemini-2.5-flash') ? 'bg-blue-500 border-blue-500 text-white' : 'border-slate-300'}`}>
                {selectedModels.includes('googleai/gemini-2.5-flash') && <Check className="h-2 w-2" />}
              </div>
              <Cpu className={`h-3 w-3 ${selectedModels.includes('googleai/gemini-2.5-flash') ? 'text-blue-500' : ''}`} />
              Gemini
            </button>
          </div>
          
          <nav className="hidden md:flex items-center gap-6 ml-4">
            <Link href="#" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">Dashboard</Link>
          </nav>
        </div>
      </div>
    </header>
  );
}