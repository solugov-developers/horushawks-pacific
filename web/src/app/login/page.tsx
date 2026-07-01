import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const redirectTo = sp.next && sp.next.startsWith('/') ? sp.next : '/';

  return (
    <main className="marble-bg min-h-screen flex items-center justify-center px-6 py-12">
      <div
        className="w-full max-w-sm rounded-2xl border border-border px-8 py-10 backdrop-blur-xl backdrop-saturate-150 shadow-[var(--shadow-lg)]"
        style={{ backgroundColor: 'color-mix(in srgb, var(--surface) 70%, transparent)' }}
      >
        <div className="mb-8 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/horushawks-mark.png"
            alt=""
            width={72}
            height={72}
            className="mb-4"
          />
          <h1 className="font-display text-2xl text-text-strong">HorusHawks</h1>
          <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-text-muted">
            Precision intelligence extraction
          </p>
        </div>

        <LoginForm redirectTo={redirectTo} />
      </div>
    </main>
  );
}
