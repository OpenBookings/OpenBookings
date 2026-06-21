import {
  Coffee, Utensils, Waves, Plane,
  Landmark, ShoppingBag, TreePine, Train,
} from "lucide-react";

export const NAV_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "rooms",    label: "Rooms" },
  { id: "policies", label: "Policies" },
  { id: "location", label: "Location" },
  { id: "book",     label: "Footnote" },
] as const;

export type NavSectionId = typeof NAV_SECTIONS[number]["id"];

export const AMENITIES_PREVIEW = 10;
export const PILLS_PER_ROW = 5;

export const HIGHLIGHTS = [
  { icon: Waves,       label: "Private Beach",          distance: "50 m" },
  { icon: Utensils,    label: "Il Corallo Restaurant",  distance: "120 m" },
  { icon: Coffee,      label: "Caffè Portoferraio",     distance: "400 m" },
  { icon: Landmark,    label: "Napoleonic Museum",      distance: "1.2 km" },
  { icon: ShoppingBag, label: "Old Town Market",        distance: "1.5 km" },
  { icon: TreePine,    label: "Monte Capanne Park",     distance: "3.8 km" },
  { icon: Train,       label: "Portoferraio Pier",      distance: "2.1 km" },
  { icon: Plane,       label: "Marina di Campo Airport", distance: "18 km" },
];

// ── DB-backed types ────────────────────────────────────────────────────────────

export type DbAmenityItem = { label: string; icon: string };
export type DbAmenityCategory = { label: string; items: DbAmenityItem[] };

export type DbRatePlan = {
  id: string;
  name: string;
  bar: number;
  currency: string;
  is_refundable: boolean;
  cancellation_policy: string | null;
  meal_plan: string | null;
};

export type DbRoom = {
  id: string;
  name: string;
  description: string | null;
  room_type: string | null;
  bed_type: string | null;
  size_sqm: number | null;
  max_occupancy: number | null;
  images: string[];
  rate_plans: DbRatePlan[];
  tags: string[];
};
