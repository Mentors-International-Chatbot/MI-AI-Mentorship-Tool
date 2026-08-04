'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';

type NavChild = { href: string; label: string };

type NavItem =
  | { href: string; label: string }
  | { label: string; key: string; children: NavChild[] };

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard/learners', label: 'Mentor dashboard' },
  { href: '/chat', label: 'Web chat' },
  { href: '/admin', label: 'Overview' },
  {
    key: 'config',
    label: 'Config',
    children: [
      { href: '/admin/config', label: 'Settings' },
      { href: '/admin/prompts', label: 'Prompts' },
    ],
  },
  {
    key: 'debug',
    label: 'Debug',
    children: [
      { href: '/admin/logs', label: 'Logs' },
      { href: '/admin/feedback', label: 'Feedback' },
    ],
  },
  { href: '/admin/learners', label: 'Learners' },
  { href: '/admin/mentors', label: 'Mentors' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/learner-feedback', label: 'All satisfaction' },
];

function isHrefActive(href: string, pathname: string) {
  if (href === '/admin') return pathname === '/admin';
  return pathname.startsWith(href);
}

function isGroupActive(children: NavChild[], pathname: string) {
  return children.some((c) => isHrefActive(c.href, pathname));
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const openGroup = NAV_ITEMS.find(
    (i): i is { label: string; key: string; children: NavChild[] } =>
      'key' in i && i.key === openDropdown
  );

  function closeDropdown() {
    setOpenDropdown(null);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#1B2A4A] text-white">
        <nav className="px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-8">
              <h1 className="text-xl font-bold">Admin Dashboard</h1>
              <div className="flex flex-wrap gap-1">
                {NAV_ITEMS.map((item) => {
                  if ('href' in item) {
                    const active = isHrefActive(item.href, pathname);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={closeDropdown}
                        className={`px-3 py-1.5 rounded text-sm transition-colors ${
                          active
                            ? 'bg-white/20 text-white font-medium'
                            : 'text-gray-300 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  }

                  const groupActive = isGroupActive(item.children, pathname);
                  const open = openDropdown === item.key;
                  const menuId = `admin-nav-${item.key}-menu`;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      aria-controls={menuId}
                      onClick={() =>
                        setOpenDropdown((prev) => (prev === item.key ? null : item.key))
                      }
                      className={`px-3 py-1.5 rounded text-sm transition-colors ${
                        groupActive || open
                          ? 'bg-white/20 text-white font-medium'
                          : 'text-gray-300 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-300">Mentors International</span>
              <button
                onClick={async () => {
                  await fetch('/api/auth/logout', { method: 'POST' });
                  window.location.href = '/login';
                }}
                className="text-xs text-gray-400 hover:text-white transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </nav>

        {openGroup && (
          <div
            id={`admin-nav-${openGroup.key}-menu`}
            className="border-t border-white/10 px-6 py-2"
          >
            <div className="max-w-7xl mx-auto flex flex-wrap gap-1">
              {openGroup.children.map((child) => {
                const active = isHrefActive(child.href, pathname);
                return (
                  <Link
                    key={child.href}
                    href={child.href}
                    onClick={closeDropdown}
                    className={`px-3 py-1.5 rounded text-sm transition-colors ${
                      active
                        ? 'bg-white/25 text-white font-medium'
                        : 'text-gray-300 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {child.label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
