'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/dashboard/socios', label: 'Mentor dashboard' },
  { href: '/chat', label: 'Web chat' },
  { href: '/admin', label: 'Overview' },
  { href: '/admin/logs', label: 'Logs' },
  { href: '/admin/config', label: 'Config' },
  { href: '/admin/prompts', label: 'Prompts' },
  { href: '/admin/socios', label: 'Socios' },
  { href: '/admin/mentors', label: 'Mentors' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/feedback', label: 'Feedback' },
  { href: '/admin/socio-feedback', label: 'All satisfaction' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-[#1B2A4A] text-white px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="text-xl font-bold">Admin Dashboard</h1>
            <div className="flex gap-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded text-sm transition-colors ${
                    isActive(item.href)
                      ? 'bg-white/20 text-white font-medium'
                      : 'text-gray-300 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
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
      <main className="max-w-7xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  );
}
