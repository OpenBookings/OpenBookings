import type { MDXComponents } from "mdx/types";
import {
  Callout,
  CardGroup,
  Choice,
  ChoiceList,
  DashList,
  DataCard,
  InlineLink,
  Lead,
  Meta,
  Note,
  Panel,
  Section,
} from "@/components/legal/elements";

/**
 * Global MDX mapping.
 *
 * Markdown primitives are styled here rather than in the documents so that a
 * legal document stays plain prose: a translator edits headings, sentences and
 * table cells, never a className. Native markdown tables replace the old
 * `StyledTable` props API for the same reason — `**Neon**` and `` `ph_*` ``
 * express the bold-first-column and code-column variants without any JSX.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    // Structural components, available without an import.
    Section,
    Lead,
    DataCard,
    CardGroup,
    Meta,
    Callout,
    Note,
    InlineLink,
    Choice,
    ChoiceList,
    Panel,
    DashList,

    p: ({ children }) => <p className="mb-3 leading-relaxed text-white/70">{children}</p>,

    h3: ({ children }) => (
      <h3 className="mb-3 mt-6 font-semibold text-white/90">{children}</h3>
    ),

    ul: ({ children }) => <ul className="mb-6 space-y-3">{children}</ul>,

    li: ({ children }) => (
      <li className="flex items-start gap-3 leading-relaxed text-white/70">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-white/30" />
        <span className="min-w-0">{children}</span>
      </li>
    ),

    a: ({ href, children }) => {
      const external = Boolean(href?.startsWith("http"));
      return (
        <InlineLink href={href ?? "#"} external={external}>
          {children}
        </InlineLink>
      );
    },

    strong: ({ children }) => <strong className="font-medium text-white/80">{children}</strong>,

    code: ({ children }) => (
      <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-white/70">{children}</code>
    ),

    table: ({ children }) => (
      <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
        <table className="w-full text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="border-b border-white/7 bg-white/3">{children}</thead>
    ),
    // `tr` is intentionally left unmapped: markdown already emits one inside
    // both thead and tbody, so wrapping it here would nest <tr> in <tr>.
    tbody: ({ children }) => (
      <tbody className="[&>tr]:border-b [&>tr]:border-white/4 [&>tr:last-child]:border-0 [&>tr]:transition-colors [&>tr:hover]:bg-white/2">
        {children}
      </tbody>
    ),
    th: ({ children }) => (
      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/40">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-4 py-3 leading-snug text-white/60">{children}</td>
    ),

    ...components,
  };
}
