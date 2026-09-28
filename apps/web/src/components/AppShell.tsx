import { ChevronDown, GitBranch, History, LayoutDashboard, LogOut, Search } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { CommandPalette, useCommandPalette } from '@/components/CommandPalette';
import { Kbd } from '@/components/Kbd';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/features/auth/AuthContext';
import { MOD_KEY } from '@/lib/hotkeys';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/workflows', label: 'Workflows', icon: GitBranch, end: false },
  { to: '/app/executions', label: 'Executions', icon: History, end: false },
];

export function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const palette = useCommandPalette();

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
        <NavLink to="/app" className="mr-2 flex items-center gap-2 pl-1 pr-2">
          <FlowMark />
          <span className="text-[13px] font-semibold tracking-tight text-text">Flow</span>
        </NavLink>

        <nav className="flex items-center gap-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-7 items-center gap-1.5 rounded-sm px-2 text-[13px] transition-colors',
                  isActive
                    ? 'bg-surface-hover text-text'
                    : 'text-text-muted hover:bg-surface-raised hover:text-text',
                )
              }
            >
              <Icon className="size-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => palette.setOpen(true)}
          className="mr-1 hidden h-7 items-center gap-2 rounded-sm border border-border bg-surface px-2 text-[12px] text-text-subtle transition-colors hover:border-border-strong hover:text-text-muted md:flex"
        >
          <Search className="size-3.5" />
          <span>Search…</span>
          <Kbd className="ml-2">{`${MOD_KEY}K`}</Kbd>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 pl-1.5">
              <span className="flex size-5 items-center justify-center rounded-full bg-accent-muted text-[10px] font-semibold uppercase text-accent">
                {user?.name?.[0] ?? '?'}
              </span>
              <span className="hidden max-w-28 truncate text-[13px] sm:inline">{user?.name}</span>
              <ChevronDown className="size-3 text-text-subtle" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <div className="px-2 py-1.5">
              <p className="text-[13px] font-medium text-text">{user?.name}</p>
              <p className="truncate font-mono text-[11px] text-text-subtle">{user?.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              onSelect={async () => {
                await signOut();
                navigate('/login');
              }}
            >
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>

      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
    </div>
  );
}

export function FlowMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-[18px]', className)} aria-hidden>
      <circle cx="9" cy="16" r="3.2" fill="var(--color-accent)" />
      <circle cx="23" cy="9" r="3.2" fill="var(--color-success)" />
      <circle cx="23" cy="23" r="3.2" fill="var(--color-warning)" />
      <path
        d="M11.8 14.6 20.2 10.4M11.8 17.4 20.2 21.6"
        stroke="var(--color-border-strong)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
