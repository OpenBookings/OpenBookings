import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/notebook';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/'>) {
  const { nav, ...base } = baseOptions();

  return (
    <DocsLayout tree={source.getPageTree()} {...base} nav={{ ...nav, mode: 'top' }}>
      {children}
    </DocsLayout>
  );
}
