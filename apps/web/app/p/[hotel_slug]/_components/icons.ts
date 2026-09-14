import { Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as Icons from "lucide-react";

/**
 * Maps icon name strings stored in the DB to Lucide components.
 * Handles both PascalCase ("BedDouble") and kebab-case ("bed-double").
 *
 * This lives in its own module, and not in AmenitiesSection.tsx where it began,
 * because LocationSection is a server component: importing a plain function out
 * of a "use client" module gives the server a client reference, and calling it
 * throws at render. Two copies would drift instead — one section rendering
 * Sparkles for everything while the other resolves correctly.
 */
export function toPascalCase(s: string) {
  return s.replace(/(^\w|-\w)/g, (m) => m.replace("-", "").toUpperCase());
}

export function getIcon(name: string): LucideIcon {
  const pascal = toPascalCase(name);
  const icon = (Icons as Record<string, unknown>)[pascal] ?? (Icons as Record<string, unknown>)[name];
  return (typeof icon === "function" ? icon : Sparkles) as LucideIcon;
}
