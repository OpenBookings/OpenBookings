/**
 * The Host Agreement MDX exports its title alongside the default component,
 * as the legal documents in apps/web do. `@types/mdx` only declares the
 * default export for `*.mdx`; this merges the named export into it.
 */
declare module "*.mdx" {
  export const title: string;
}
