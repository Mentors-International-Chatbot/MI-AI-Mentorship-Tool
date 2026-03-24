'use client';

export function LogoutButton() {
  return (
    <button
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
      }}
      className="text-xs text-gray-400 hover:text-white transition-colors"
    >
      Sign Out
    </button>
  );
}
