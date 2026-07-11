import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/session';

// Rotas públicas — não exigem login
const PUBLIC_PATHS = ['/login'];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Estáticos / next internals — não interceptar
  if (pathname.startsWith('/_next') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Públicas
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname + (req.nextUrl.search || ''));
    return NextResponse.redirect(url);
  }

  // Telas restritas a admin (ex.: SQL runner). Viewers são redirecionados p/ home.
  const ADMIN_ONLY = ['/sql'];
  if (
    ADMIN_ONLY.some((p) => pathname === p || pathname.startsWith(p + '/')) &&
    session.role !== 'admin'
  ) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Aplica a todas as rotas exceto arquivos estáticos
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
