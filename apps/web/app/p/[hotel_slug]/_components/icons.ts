import {
  Accessibility,
  Anchor,
  Baby,
  Bath,
  BedDouble,
  Bike,
  Briefcase,
  Bus,
  Car,
  ChefHat,
  Coffee,
  ConciergeBell,
  Droplets,
  Dumbbell,
  Flame,
  Footprints,
  Heart,
  Landmark,
  Leaf,
  MapPin,
  Moon,
  PawPrint,
  Plane,
  Shield,
  Shirt,
  ShoppingBag,
  Snowflake,
  Sparkles,
  Sun,
  Train,
  TreePine,
  Trophy,
  Tv,
  Utensils,
  Waves,
  Wifi,
  Wind,
  Wine,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Maps icon name strings stored in the DB to Lucide components.
 * Handles both PascalCase ("BedDouble") and kebab-case ("bed-double").
 *
 * The icons are listed one by one on purpose. Looking names up on
 * `import * as Icons` shipped every Lucide icon (~250 KB gzipped) to the
 * listing page. The list covers every icon in the amenities table and the
 * nearby-place icons the host editor offers (HIGHLIGHT_ICONS in
 * apps/business). A name that is not here renders as Sparkles, so a new
 * amenity icon needs adding here as well.
 *
 * This lives in its own module, and not in AmenitiesSection.tsx where it began,
 * because LocationSection is a server component: importing a plain function out
 * of a "use client" module gives the server a client reference, and calling it
 * throws at render. Two copies would drift instead — one section rendering
 * Sparkles for everything while the other resolves correctly.
 */
const ICONS: Record<string, LucideIcon> = {
  Accessibility,
  Anchor,
  Baby,
  Bath,
  BedDouble,
  Bike,
  Briefcase,
  Bus,
  Car,
  ChefHat,
  Coffee,
  ConciergeBell,
  Droplets,
  Dumbbell,
  Flame,
  Footprints,
  Heart,
  Landmark,
  Leaf,
  MapPin,
  Moon,
  PawPrint,
  Plane,
  Shield,
  Shirt,
  ShoppingBag,
  Snowflake,
  Sparkles,
  Sun,
  Train,
  TreePine,
  Trophy,
  Tv,
  Utensils,
  Waves,
  Wifi,
  Wind,
  Wine,
  Zap,
};

function toPascalCase(s: string) {
  return s.replace(/(^\w|-\w)/g, (m) => m.replace("-", "").toUpperCase());
}

export function getIcon(name: string): LucideIcon {
  return ICONS[toPascalCase(name)] ?? ICONS[name] ?? Sparkles;
}
