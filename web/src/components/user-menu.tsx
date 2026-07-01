import { LogOut } from 'lucide-react';
import { getSession } from '@/lib/session';
import { logoutAction } from '@/app/login/actions';

export async function UserMenu() {
  const session = await getSession();
  if (!session) return null;

  return (
    <div className="flex items-center gap-3">
      <div className="text-sm text-text-muted hidden md:block">
        <span className="text-text">{session.username}</span>
      </div>
      <form action={logoutAction}>
        <button
          type="submit"
          title="Sair"
          className="inline-flex items-center justify-center size-8 rounded-full text-text-muted hover:bg-surface-2 hover:text-text transition-colors"
        >
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}
