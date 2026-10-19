"use client";

import Link from "next/link";
import * as React from "react";
import { parseMarkdown, type InlineToken } from "@/lib/support/markdown";

function Inline({ tokens }: { tokens: InlineToken[] }) {
  return tokens.map((token, i) => {
    switch (token.type) {
      case "text":
        return <React.Fragment key={i}>{token.text}</React.Fragment>;
      case "bold":
        return (
          <strong key={i} className="font-semibold">
            <Inline tokens={token.children} />
          </strong>
        );
      case "code":
        return (
          <code key={i} className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {token.text}
          </code>
        );
      case "link":
        // App links stay in the tab (the panel survives navigation); others open a new one.
        return token.internal ? (
          <Link key={i} href={token.href} className="underline underline-offset-3 hover:text-foreground">
            <Inline tokens={token.children} />
          </Link>
        ) : (
          <a
            key={i}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-3 hover:text-foreground"
          >
            <Inline tokens={token.children} />
          </a>
        );
    }
  });
}

/** Replies rendered from parsed tokens — never as HTML. */
export function SupportMarkdown({ text, appOrigin }: { text: string; appOrigin: string | null }) {
  const blocks = React.useMemo(() => parseMarkdown(text, appOrigin ?? undefined), [text, appOrigin]);
  return (
    <div className="flex flex-col gap-2 whitespace-pre-wrap">
      {blocks.map((block, i) =>
        block.type === "paragraph" ? (
          <p key={i}>
            <Inline tokens={block.children} />
          </p>
        ) : block.ordered ? (
          <ol key={i} className="flex list-decimal flex-col gap-1 pl-5 whitespace-normal">
            {block.items.map((item, j) => (
              <li key={j}>
                <Inline tokens={item} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-5 whitespace-normal">
            {block.items.map((item, j) => (
              <li key={j}>
                <Inline tokens={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
