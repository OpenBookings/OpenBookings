import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { Gloock, Inter, Libre_Franklin } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
});

// Brand faces, shared with apps/web: Gloock sets display copy, Libre Franklin
// carries UI text on the marketing surfaces. Docs body copy stays on Inter.
const gloock = Gloock({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-gloock',
  display: 'swap',
});

const libreFranklin = Libre_Franklin({
  subsets: ['latin'],
  variable: '--font-libre-franklin',
  display: 'swap',
});

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${inter.className} ${gloock.variable} ${libreFranklin.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
