"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCommandPaletteStore } from "@/store/useCommandPaletteStore";
import { useThemeStore } from "@/store/useThemeStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useUserPrefsStore } from "@/store/useUserPrefsStore";

interface Command {
  id: string;
  label: string;
  /** Search keywords beyond the label — e.g. abbreviations, synonyms. */
  keywords?: string;
  /** Path under the route hierarchy used for icons / grouping ("nav", "theme", "session"). */
  group: 'nav' | 'theme' | 'session' | 'action';
  /** What to do when the command is selected. */
  run: () => void;
}

function fuzzyMatch(query: string, target: string): boolean {
  // Cheap subsequence match — every char of `query` appears in `target`
  // in order. Empty query matches everything (the "no filter" case).
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}

/**
 * Cmd+K command palette. Mounted globally inside the office layout so
 * it's available on every authenticated page. Keyboard:
 *   Cmd/Ctrl+K   open/close
 *   Esc          close
 *   ↑ / ↓        move selection
 *   Enter        run selected command
 */
export function CommandPalette() {
  const router = useRouter();
  const { open, setOpen, toggle } = useCommandPaletteStore();
  const { theme, setTheme } = useThemeStore();
  const { logout } = useAuthStore();
  const soundsEnabled = useUserPrefsStore((s) => s.notificationSoundsEnabled);
  const setSoundsEnabled = useUserPrefsStore((s) => s.setNotificationSoundsEnabled);
  const density = useUserPrefsStore((s) => s.density);
  const setDensity = useUserPrefsStore((s) => s.setDensity);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = useMemo(() => [
    { id: 'nav-dashboard', label: 'Go to Dashboard', keywords: 'home office', group: 'nav', run: () => router.push('/office') },
    { id: 'nav-agents', label: 'Go to Agents', keywords: 'bot', group: 'nav', run: () => router.push('/office/agents') },
    { id: 'nav-chat', label: 'Go to Chat', keywords: 'message conversation', group: 'nav', run: () => router.push('/office/chat') },
    { id: 'nav-approvals', label: 'Go to Approvals', keywords: 'approve queue', group: 'nav', run: () => router.push('/office/approvals') },
    { id: 'nav-projects', label: 'Go to Projects', group: 'nav', run: () => router.push('/office/projects') },
    { id: 'nav-workspaces', label: 'Go to Workspaces', group: 'nav', run: () => router.push('/office/workspaces') },
    { id: 'nav-settings', label: 'Go to Settings', keywords: 'preferences config', group: 'nav', run: () => router.push('/office/settings') },
    { id: 'theme-dark', label: 'Switch to Dark theme', group: 'theme', run: () => setTheme('dark') },
    { id: 'theme-light', label: 'Switch to Light theme', group: 'theme', run: () => setTheme('light') },
    { id: 'theme-system', label: 'Use System theme', group: 'theme', run: () => setTheme('system') },
    { id: 'session-logout', label: 'Sign out', keywords: 'logout exit', group: 'session', run: () => { logout(); router.push('/login'); } },
    {
      id: 'prefs-sounds-toggle',
      label: soundsEnabled ? 'Disable notification sounds' : 'Enable notification sounds',
      keywords: 'audio mute beep chime',
      group: 'action',
      run: () => setSoundsEnabled(!soundsEnabled),
    },
    {
      id: 'prefs-density-toggle',
      label: density === 'compact' ? 'Switch to comfortable density' : 'Switch to compact density',
      keywords: 'spacing layout',
      group: 'action',
      run: () => setDensity(density === 'compact' ? 'comfortable' : 'compact'),
    },
  ], [router, setTheme, logout, soundsEnabled, setSoundsEnabled, density, setDensity]);

  const filtered = useMemo(() => {
    if (!query) return commands;
    return commands.filter((c) => fuzzyMatch(query, `${c.label} ${c.keywords ?? ''}`));
  }, [query, commands]);

  // Global Cmd+K / Ctrl+K toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  // Reset state + autofocus when opened.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      // Focus deferred to next tick so the input has mounted.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Reset selection when filter changes.
  useEffect(() => { setSelectedIdx(0); }, [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[selectedIdx];
      if (cmd) {
        cmd.run();
        setOpen(false);
      }
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      data-testid="command-palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg mx-4 rounded-lg border border-white/10 bg-neutral-900 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command or search…"
          aria-label="Command palette input"
          className="w-full px-4 py-3 bg-transparent text-white placeholder:text-white/40 outline-none border-b border-white/10"
        />
        <ul
          role="listbox"
          aria-label="Available commands"
          className="max-h-[50vh] overflow-y-auto py-1"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-white/50">No commands match.</li>
          ) : (
            filtered.map((cmd, idx) => (
              <li
                key={cmd.id}
                role="option"
                aria-selected={idx === selectedIdx}
                data-testid={`command-${cmd.id}`}
                onMouseEnter={() => setSelectedIdx(idx)}
                onClick={() => {
                  cmd.run();
                  setOpen(false);
                }}
                className={`flex items-center justify-between px-4 py-2 text-sm cursor-pointer ${idx === selectedIdx ? 'bg-white/10' : ''}`}
              >
                <span>{cmd.label}</span>
                <span className="text-xs uppercase tracking-wide text-white/40">{cmd.group}</span>
              </li>
            ))
          )}
        </ul>
        <div className="px-4 py-2 border-t border-white/10 text-xs text-white/40 flex items-center gap-3">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
          <span className="ml-auto">{theme} theme</span>
        </div>
      </div>
    </div>
  );
}
