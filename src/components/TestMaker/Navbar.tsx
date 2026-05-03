"use client";

import { GraduationCap } from "lucide-react";
import Link from "next/link";

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="bg-primary p-2 rounded-lg group-hover:bg-primary/90 transition-colors">
            <GraduationCap className="h-6 w-6 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-primary font-headline">TestMaker</span>
        </Link>
        <nav className="hidden md:flex items-center gap-6">
          <Link href="#" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">How it works</Link>
          <Link href="#" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">Pricing</Link>
          <Link href="#" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">Dashboard</Link>
        </nav>
      </div>
    </header>
  );
}