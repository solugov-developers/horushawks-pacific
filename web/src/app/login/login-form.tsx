'use client';

import { useActionState } from 'react';
import { loginAction, type LoginState } from './actions';
import { Button } from '@/components/button';

interface Props {
  redirectTo: string;
}

const inputClasses =
  'w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm transition-shadow focus:border-accent-500 focus:ring-2 focus:ring-accent-500/25 focus:outline-none';

const labelClasses =
  'block text-[11px] font-medium tracking-[0.12em] uppercase text-text-soft mb-1.5';

export function LoginForm({ redirectTo }: Props) {
  const [state, formAction, pending] = useActionState<LoginState | null, FormData>(loginAction, null);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <div>
        <label htmlFor="username" className={labelClasses}>
          Usuário
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoFocus
          required
          className={inputClasses}
          placeholder="admin"
        />
      </div>

      <div>
        <label htmlFor="password" className={labelClasses}>
          Senha
        </label>
        <input
          id="password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          className={inputClasses}
          placeholder="••••••••"
        />
      </div>

      {state?.error && (
        <div className="rounded-xl bg-negative-bg text-negative-fg text-sm px-3 py-2 border border-border">
          {state.error}
        </div>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Entrando…' : 'Entrar'}
      </Button>
    </form>
  );
}
