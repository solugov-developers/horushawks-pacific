'use server';

import { redirect } from 'next/navigation';
import { verifyUserCredentials } from '@/lib/queries/users';
import { createSession, destroySession } from '@/lib/session';

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState | null, formData: FormData): Promise<LoginState> {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const redirectTo = String(formData.get('redirectTo') ?? '/');

  if (!username || !password) {
    return { error: 'Preencha usuário e senha.' };
  }

  let user;
  try {
    user = await verifyUserCredentials(username, password);
  } catch (e) {
    console.error('[auth] erro ao verificar credenciais:', e);
    return { error: 'Erro interno. Tente novamente.' };
  }

  if (!user) {
    return { error: 'Usuário ou senha inválidos.' };
  }

  await createSession({ userId: user.id, username: user.username, role: user.role });
  redirect(redirectTo.startsWith('/') ? redirectTo : '/');
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect('/login');
}
