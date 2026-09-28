/**
 * Every legal MDX document exports its own localised title alongside the
 * default component, so the title is translated in the same file as the prose
 * rather than in a separate registry a translator would also have to edit.
 *
 * `@types/mdx` only declares the default export for `*.mdx`; this ambient
 * declaration merges the named export into it.
 */
declare module "*.mdx" {
  export const title: string;
}
