import type { ReactNode } from "react";

/**
 * Presentational building blocks for legal documents.
 *
 * These are exposed to MDX globally (see `mdx-components.tsx`), so a document
 * author — or a translator — never writes an import. The styling is carried
 * over verbatim from the original hand-written privacy page so that extracting
 * the prose into MDX is a pure refactor, not a redesign.
 */

/**
 * A numbered top-level section.
 *
 * `id` is deliberately supplied by the author rather than slugified from the
 * heading text: anchors into a legal document get cited externally (and in our
 * own code comments), so they must stay stable across both edits and
 * translations. A Dutch heading must still live at `#who-we-are`.
 */
export function Section({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: string | number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28">
      <div className="mb-5 flex items-baseline gap-3">
        <span className="shrink-0 text-sm font-semibold text-white/40">{number}.</span>
        <h2 className="text-2xl font-semibold tracking-tight text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/** The intro block directly under the document title. */
export function Lead({ children }: { children: ReactNode }) {
  return (
    <div className="mb-12 rounded-2xl border border-white/8 bg-white/3 p-6 backdrop-blur-sm [&>p]:mb-3 [&>p]:text-base [&>p]:leading-relaxed [&>p]:text-white/70 [&>p:last-child]:mb-0">
      {children}
    </div>
  );
}

/** A titled card describing one category of data. */
export function DataCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/7 bg-white/2.5 p-5">
      <h3 className="mb-3 font-semibold text-white/90">{title}</h3>
      {children}
    </div>
  );
}

/** Groups a run of `DataCard`s with the right rhythm. */
export function CardGroup({ children }: { children: ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

export type MetaLabels = { why: string; legalBasis: string };

const DEFAULT_META_LABELS: MetaLabels = { why: "Why:", legalBasis: "Legal basis:" };

/**
 * The "Why / Legal basis" footnote inside a `DataCard`.
 *
 * `why` and `basis` come from the document, but the two labels are part of the
 * chrome, and a document written in Dutch must not be annotated in English.
 * They are a prop rather than a lookup so this file stays presentational: the
 * page substitutes a localised `Meta` through the MDX `components` prop (see
 * `LegalPage`), and the English default keeps the component usable on its own.
 */
export function Meta({
  why,
  basis,
  labels = DEFAULT_META_LABELS,
}: {
  why?: string;
  basis?: string;
  labels?: MetaLabels;
}) {
  return (
    <div className="mt-3 space-y-1 text-sm text-white/40">
      {why && (
        <p>
          <strong className="text-white/50">{labels.why}</strong> {why}
        </p>
      )}
      {basis && (
        <p>
          <strong className="text-white/50">{labels.legalBasis}</strong> {basis}
        </p>
      )}
    </div>
  );
}

/** A bordered aside, e.g. the session-replay explainer. */
export function Callout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5 rounded-xl border border-white/8 bg-white/3 p-5">
      <p className="mb-2 font-medium text-white/90">{title}</p>
      <div className="[&>p]:mb-4 [&>p]:text-sm [&>p]:text-white/50 [&>ul]:mb-0 [&>p:last-child]:mb-0">
        {children}
      </div>
    </div>
  );
}

/** A de-emphasised trailing note. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-sm text-white/40">{children}</p>;
}

export function InlineLink({
  href,
  external,
  children,
}: {
  href: string;
  external?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="text-white underline underline-offset-2 decoration-white/30 hover:decoration-white/70 transition-all"
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

/** A labelled choice, e.g. the Accept / Decline rows in the cookies section. */
export function Choice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-white/70">
      <span className="mt-0.5 shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-xs font-semibold text-white/60">
        {label}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** Wraps `Choice` rows without the default bullet list styling. */
export function ChoiceList({ children }: { children: ReactNode }) {
  return <ul className="mb-6 space-y-3">{children}</ul>;
}

/** A standalone emphasised box, e.g. the contact block. */
export function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/3 p-6 backdrop-blur-sm [&>p]:mb-0 [&>p]:text-white/70">
      {children}
    </div>
  );
}

/** A dash-prefixed list, matching the original's tighter list variant. */
export function DashList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3 text-sm text-white/60">
          <span className="mt-0.5 text-white/25">–</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
