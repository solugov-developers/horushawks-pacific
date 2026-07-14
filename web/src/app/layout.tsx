import type { Metadata } from 'next';
import { Inter, Cinzel, JetBrains_Mono } from 'next/font/google';
import { TopNav } from '@/components/top-nav';
import { UserMenu } from '@/components/user-menu';
import { getSession } from '@/lib/session';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const cinzel = Cinzel({
  subsets: ['latin'],
  variable: '--font-cinzel',
  weight: ['500', '600'],
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'HorusHawks',
  description: 'Precision intelligence extraction',
  // ícones vêm de app/favicon.ico e app/apple-icon.png (file convention)
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  return (
    <html
      lang="en"
      className={`${inter.variable} ${cinzel.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-text">
        <TopNav userSlot={<UserMenu />} role={session?.role} />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
