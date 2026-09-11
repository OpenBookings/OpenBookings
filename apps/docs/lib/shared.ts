export const appName = 'OpenBookings Docs';

/** Docs live at the root — each area folder is its own top-level segment. */
export const docsRoute = '/';
export const docsImageRoute = '/og';
export const docsContentRoute = '/llms.mdx';

/**
 * Top-level segments owned by route handlers rather than the docs catch-all.
 * The proxy skips these so markdown negotiation only applies to docs pages.
 */
export const reservedRoutes = ['_next', '_search', 'og', 'llms.mdx', 'llms.txt', 'llms-full.txt'];

export const gitConfig = {
  user: 'OpenBookings',
  repo: 'OpenBookings',
  branch: 'main',
};
