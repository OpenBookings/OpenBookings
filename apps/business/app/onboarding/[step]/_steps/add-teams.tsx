"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  Sparkles,
  CalendarDays,
  Landmark,
  TrendingUp,
  Megaphone,
  Users,
  X,
  Plus,
  Mail,
  AlertTriangle,
  UserPlus,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamMember {
  id: string;
  email: string;
  role: "Manager" | "Staff";
  status: "sent" | "accepted" | "denied";
}

export interface Team {
  id: string;
  name: string;
  members: TeamMember[];
}

export interface AddTeamsValues {
  teams: Team[];
}

interface AddTeamsStepProps {
  values: AddTeamsValues;
  onChange: (values: Partial<AddTeamsValues>) => void;
}

interface TeamDefinition {
  id: string;
  name: string;
  category: string;
  Icon: LucideIcon;
  iconClass: string;
  bgClass: string;
  borderClass: string;
  buttonClass: string;
  dotClass: string;
  access: string[];
}

// ---------------------------------------------------------------------------
// Predefined teams
// ---------------------------------------------------------------------------

const PREDEFINED_TEAMS: TeamDefinition[] = [
  {
    id: "front-office",
    name: "Front Office",
    category: "OPERATIONS",
    Icon: Building2,
    iconClass: "text-blue-400",
    bgClass: "bg-blue-500/15",
    borderClass: "border-blue-500/40",
    buttonClass: "bg-blue-600 hover:bg-blue-500 border-blue-500",
    dotClass: "bg-blue-400",
    access: [
      "View reservations",
      "Manage check-in & -out",
      "Access guest profiles",
    ],
  },
  {
    id: "housekeeping",
    name: "Housekeeping",
    category: "FACILITIES",
    Icon: Sparkles,
    iconClass: "text-cyan-400",
    bgClass: "bg-cyan-500/15",
    borderClass: "border-cyan-500/40",
    buttonClass: "bg-cyan-600 hover:bg-cyan-500 border-cyan-500",
    dotClass: "bg-cyan-400",
    access: [
      "View reservations",
      "View reviews",
      "Manage room status",
    ],
  },
  {
    id: "reservations",
    name: "Reservations",
    category: "OPERATIONS",
    Icon: CalendarDays,
    iconClass: "text-indigo-400",
    bgClass: "bg-indigo-500/15",
    borderClass: "border-indigo-500/40",
    buttonClass: "bg-indigo-600 hover:bg-indigo-500 border-indigo-500",
    dotClass: "bg-indigo-400",
    access: [
      "Audit bookings",
      "Manage channels",
      "Handle cancellations",
    ],
  },
  {
    id: "finance",
    name: "Finance",
    category: "FINANCE",
    Icon: Landmark,
    iconClass: "text-emerald-400",
    bgClass: "bg-emerald-500/15",
    borderClass: "border-emerald-500/40",
    buttonClass: "bg-emerald-600 hover:bg-emerald-500 border-emerald-500",
    dotClass: "bg-emerald-400",
    access: [
      "View payments & invoices",
      "Export financial reports",
      "Access analytics dashboard",
    ],
  },
  {
    id: "revenue",
    name: "Revenue",
    category: "FINANCE",
    Icon: TrendingUp,
    iconClass: "text-green-400",
    bgClass: "bg-green-500/15",
    borderClass: "border-green-500/40",
    buttonClass: "bg-green-600 hover:bg-green-500 border-green-500",
    dotClass: "bg-green-400",
    access: [
      "Adjust pricing & rates",
      "Monitor performance KPIs",
      "Manage revenue strategy",
    ],
  },
  {
    id: "marketing",
    name: "Marketing",
    category: "MARKETING",
    Icon: Megaphone,
    iconClass: "text-pink-400",
    bgClass: "bg-pink-500/15",
    borderClass: "border-pink-500/40",
    buttonClass: "bg-pink-600 hover:bg-pink-500 border-pink-500",
    dotClass: "bg-pink-400",
    access: [
      "Design landing page",
      "Respond to reviews",
      "Manage listing content",
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ---------------------------------------------------------------------------
// Legal info banner
// ---------------------------------------------------------------------------

function LegalInfoBanner() {
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex flex-row items-center max-w-3xl">
      <div className="flex flex-col items-center justify-center mr-4">
        <AlertTriangle className="size-8 text-amber-400/80" />
      </div>
      <div className="flex-1 flex flex-col items-start gap-1">
        <h2 className="text-amber-400/80 font-semibold">
          Keep access clean from the start
        </h2>
        <p className="text-sm text-amber-200/60 leading-relaxed">
          Sharing a single login exposes guest data, payouts, and legal documents to everyone.
          <br />
          Teams give each person exactly the access they need, and nothing more.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Member row
// ---------------------------------------------------------------------------

function MemberRow({ member, onRemove }: { member: TeamMember; onRemove: (id: string) => void }) {
  const statusConfig = {
    sent: { label: "Sent", className: "text-white/40 bg-white/5 border-white/10" },
    accepted: { label: "Accepted", className: "text-green-400 bg-green-500/10 border-green-500/20" },
    denied: { label: "Denied", className: "text-red-400 bg-red-500/10 border-red-500/20" },
  };
  const s = statusConfig[member.status];

  return (
    <div className="flex items-center gap-2 group">
      <Mail className="size-3 shrink-0 text-white/20" />
      <span className="flex-1 text-xs text-white/60 truncate min-w-0">{member.email}</span>
      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-md border shrink-0", s.className)}>
        {s.label}
      </span>
      <button
        type="button"
        onClick={() => onRemove(member.id)}
        className="shrink-0 text-white/10 hover:text-red-400/60 transition-colors opacity-0 group-hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function MemberGroup({ label, members, onRemove }: {
  label: string;
  members: TeamMember[];
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30">{label}</p>
      <div className="flex flex-col gap-1.5">
        {members.map((m) => (
          <MemberRow key={m.id} member={m} onRemove={onRemove} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invite overlay (the "back" of the card — flips in from the card position)
// ---------------------------------------------------------------------------

interface InviteOverlayProps {
  def: TeamDefinition;
  members: TeamMember[];
  originRect: DOMRect;
  onClose: () => void;
  onAddMember: (email: string, role: "Manager" | "Staff") => void;
  onRemoveMember: (id: string) => void;
}

function InviteOverlay({ def, members, originRect, onClose, onAddMember, onRemoveMember }: InviteOverlayProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"Manager" | "Staff">("Manager");
  const [error, setError] = useState("");
  const closingRef = useRef(false);

  useEffect(() => {
    const card = cardRef.current;
    const backdrop = backdropRef.current;
    if (!card || !backdrop) return;

    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const ox = originRect.left + originRect.width / 2 - cx;
    const oy = originRect.top + originRect.height / 2 - cy;
    const scaleX = originRect.width / 440;

    gsap.set(card, { rotateY: -180, x: ox, y: oy, scale: scaleX, opacity: 0 });
    gsap.set(backdrop, { opacity: 0 });

    const tl = gsap.timeline();
    tl.to(backdrop, { opacity: 1, duration: 0.3, ease: "power2.out" }, 0);
    tl.to(card, {
      rotateY: 0,
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      duration: 0.55,
      ease: "power3.out",
    }, 0);

    return () => { tl.kill(); };
  }, [originRect]);

  function handleClose() {
    if (closingRef.current) return;
    closingRef.current = true;

    const tl = gsap.timeline({ onComplete: onClose });
    tl.to(backdropRef.current, { opacity: 0, duration: 0.25, ease: "power2.in" }, 0);
    tl.to(cardRef.current, { rotateY: 90, scale: 0.85, opacity: 0, duration: 0.25, ease: "power2.in" }, 0);
  }

  function handleSend() {
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    if (members.some((m) => m.email.toLowerCase() === trimmed.toLowerCase())) {
      setError("Already invited to this team.");
      return;
    }
    onAddMember(trimmed, role);
    setEmail("");
    setError("");
  }

  const managers = members.filter((m) => m.role === "Manager");
  const Manager = members.filter((m) => m.role === "Staff");
  const { Icon, iconClass, bgClass, borderClass } = def;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ perspective: 1400 }}
    >
      {/* Backdrop */}
      <div
        ref={backdropRef}
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Card */}
      <div
        ref={cardRef}
        className={cn(
          "relative w-[440px] max-h-[85vh] rounded-2xl border bg-[#0e0e10] flex flex-col overflow-hidden shadow-2xl",
          borderClass
        )}
        style={{ willChange: "transform, opacity" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b border-white/8">
          <div className={cn("size-10 rounded-xl flex items-center justify-center shrink-0", bgClass)}>
            <Icon className={cn("size-5", iconClass)} />
          </div>
          <div className="flex-1 min-w-0 text-center">
            <p className="text-base font-bold text-white">{def.name}</p>
            <p className="text-xs text-white/35">Invite team members</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-white/20 hover:text-white/60 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Input area */}
        <div className="p-5 border-b border-white/8 flex flex-col gap-3">
          {/* Role toggle */}
          <div className="flex gap-1 p-1 rounded-lg bg-white/4 border border-white/6 self-start">
            {(["Manager", "Staff"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-semibold capitalize transition-all duration-150",
                  role === r
                    ? "bg-white/12 text-white shadow-sm"
                    : "text-white/35 hover:text-white/60"
                )}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Email + send */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/25" />
              <input
                autoFocus
                type="email"
                placeholder="Email address…"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSend(); } }}
                className={cn(
                  "h-9 w-full rounded-xl border bg-white/4 pl-9 pr-3 text-sm outline-none transition-colors",
                  "placeholder:text-white/20 text-white/80",
                  "focus:border-white/30",
                  error ? "border-red-500/50" : "border-white/10"
                )}
              />
            </div>
            <button
              type="button"
              onClick={handleSend}
              className="h-9 px-3 flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/4 text-white/50 hover:bg-white/8 hover:text-white/80 transition-colors text-xs font-semibold shrink-0"
            >
              <Send className="size-3.5" />
              Send
            </button>
          </div>
          {error && <p className="text-xs text-red-400/70">{error}</p>}
        </div>

        {/* Member list */}
        {members.length > 0 ? (
          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
            {managers.length > 0 && (
              <MemberGroup label="Manager" members={managers} onRemove={onRemoveMember} />
            )}
            {Manager.length > 0 && (
              <MemberGroup label="Staff" members={Manager} onRemove={onRemoveMember} />
            )}
          </div>
        ) : (
          <div className="p-8 flex flex-col items-center justify-center gap-2 text-white/15">
            <Users className="size-8" />
            <p className="text-sm">No invites sent yet</p>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Team card
// ---------------------------------------------------------------------------

interface TeamCardProps {
  def: TeamDefinition;
  addedTeam: Team | undefined;
  onAdd: () => void;
  onRemove: () => void;
  onAddMember: (email: string, role: "Manager" | "Staff") => void;
  onRemoveMember: (memberId: string) => void;
}

function TeamCard({ def, addedTeam, onAdd, onRemove, onAddMember, onRemoveMember }: TeamCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [originRect, setOriginRect] = useState<DOMRect | null>(null);

  const isAdded = Boolean(addedTeam);

  function handleRemove() {
    setInviteOpen(false);
    onRemove();
  }

  function handleOpenInvite() {
    if (!cardRef.current) return;
    setOriginRect(cardRef.current.getBoundingClientRect());
    setInviteOpen(true);
  }

  const { Icon, iconClass, bgClass, borderClass, buttonClass, dotClass, access } = def;

  return (
    <>
      <div
        ref={cardRef}
        className={cn(
          "rounded-2xl border bg-white/3 flex flex-col transition-all duration-200",
          isAdded ? borderClass : "border-white/8 hover:border-white/15"
        )}
      >
        <div className="p-5 flex flex-col gap-3 flex-1">
          {/* Icon + remove */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className={cn("size-14 rounded-xl flex items-center justify-center shrink-0", bgClass)}>
                <Icon className={cn("size-7", iconClass)} />
              </div>
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex flex-col items-start gap-2 min-w-0">
                  <p className={cn("text-base font-bold leading-tight truncate", isAdded ? "text-white" : "text-white/80")}>
                    {def.name}
                  </p>
                  <span className="inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                    {def.category}
                  </span>
                </div>
              </div>
            </div>
            {isAdded && (
              <button
                type="button"
                onClick={handleRemove}
                className="text-white/20 hover:text-red-400/60 transition-colors"
                title="Remove team"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          {/* Access bullet list */}
          <ul className="flex flex-col gap-2">
            {access.map((label) => (
              <li key={label} className="flex items-start gap-2.5">
                <span className={cn("mt-[5px] size-1.5 shrink-0 rounded-full", isAdded ? dotClass : "bg-white/20")} />
                <span className="text-sm text-white/50 leading-snug">{label}</span>
              </li>
            ))}
          </ul>

          {/* Invite count badge when members exist */}
          {isAdded && addedTeam!.members.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-white/35">
              <Users className="size-3" />
              <span>{addedTeam!.members.length} invite{addedTeam!.members.length !== 1 ? "s" : ""} sent</span>
            </div>
          )}
        </div>

        {/* Action button */}
        <div className="px-5 pb-5">
          {!isAdded ? (
            <button
              type="button"
              onClick={onAdd}
              className={cn(
                "w-full h-10 rounded-xl border text-sm font-semibold transition-all duration-150 flex items-center justify-center gap-2 text-white shadow-sm",
                buttonClass
              )}
            >
              <Plus className="size-4" />
              Add
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOpenInvite}
              className="w-full h-10 rounded-xl border border-white/10 text-sm font-semibold transition-colors flex items-center justify-center gap-2 text-white/50 hover:border-white/20 hover:bg-white/4 hover:text-white/70"
            >
              <UserPlus className="size-4" />
              {addedTeam!.members.length > 0 ? `Invite users (${addedTeam!.members.length})` : "Invite users"}
            </button>
          )}
        </div>
      </div>

      {/* Invite overlay portal */}
      {inviteOpen && originRect && (
        <InviteOverlay
          def={def}
          members={addedTeam?.members ?? []}
          originRect={originRect}
          onClose={() => setInviteOpen(false)}
          onAddMember={onAddMember}
          onRemoveMember={onRemoveMember}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main step
// ---------------------------------------------------------------------------

export function AddTeamsStep({ values, onChange }: AddTeamsStepProps) {
  function handleAdd(defId: string) {
    const def = PREDEFINED_TEAMS.find((d) => d.id === defId);
    if (!def || values.teams.some((t) => t.id === defId)) return;
    onChange({ teams: [...values.teams, { id: defId, name: def.name, members: [] }] });
  }

  function handleRemove(defId: string) {
    onChange({ teams: values.teams.filter((t) => t.id !== defId) });
  }

  function handleAddMember(defId: string, email: string, role: "Manager" | "Staff") {
    onChange({
      teams: values.teams.map((t) =>
        t.id === defId
          ? { ...t, members: [...t.members, { id: uid(), email, role, status: "sent" }] }
          : t
      ),
    });
  }

  function handleRemoveMember(defId: string, memberId: string) {
    onChange({
      teams: values.teams.map((t) =>
        t.id === defId
          ? { ...t, members: t.members.filter((m) => m.id !== memberId) }
          : t
      ),
    });
  }

  return (
    <div className="flex flex-col gap-5 pb-3">
      <LegalInfoBanner />

      <div className="grid grid-cols-3 gap-6 max-w-3xl">
        {PREDEFINED_TEAMS.map((def) => {
          const addedTeam = values.teams.find((t) => t.id === def.id);
          return (
            <TeamCard
              key={def.id}
              def={def}
              addedTeam={addedTeam}
              onAdd={() => handleAdd(def.id)}
              onRemove={() => handleRemove(def.id)}
              onAddMember={(email, role) => handleAddMember(def.id, email, role)}
              onRemoveMember={(memberId) => handleRemoveMember(def.id, memberId)}
            />
          );
        })}
      </div>
    </div>
  );
}
