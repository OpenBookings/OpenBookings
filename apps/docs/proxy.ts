import { NextRequest, NextResponse } from 'next/server';
import { isMarkdownPreferred, rewritePath } from 'fumadocs-core/negotiation';
import { docsContentRoute, reservedRoutes } from './lib/shared';

// Docs sit at the root, so these patterns match every path. Requests owned by a
// route handler are filtered out first — see `reservedRoutes`.
const { rewrite: rewriteDocs } = rewritePath('{/*path}', `${docsContentRoute}{/*path}/content.md`);
const { rewrite: rewriteSuffix } = rewritePath(
  '{/*path}.md',
  `${docsContentRoute}{/*path}/content.md`,
);

function isDocsPath(pathname: string) {
  const [, first] = pathname.split('/');
  return Boolean(first) && !reservedRoutes.includes(first);
}

export default function proxy(request: NextRequest) {
  if (!isDocsPath(request.nextUrl.pathname)) return NextResponse.next();

  const result = rewriteSuffix(request.nextUrl.pathname);
  if (result) {
    return NextResponse.rewrite(new URL(result, request.nextUrl));
  }

  if (isMarkdownPreferred(request)) {
    const result = rewriteDocs(request.nextUrl.pathname);

    if (result) {
      return NextResponse.rewrite(new URL(result, request.nextUrl), {
        // this URL has two representations, selected by `Accept`
        headers: { Vary: 'Accept' },
      });
    }
  }

  return NextResponse.next();
}
