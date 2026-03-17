import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { computeSocioHealth } from '@/lib/health/service';

export const dynamic = 'force-dynamic';

export default async function AdminSocioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const socio = await prisma.socio.findUnique({
    where: { id },
    include: { mentor: true },
  });
  if (!socio) return notFound();

  const [health, progress, flags, lessonProgress, messages] = await Promise.all([
    computeSocioHealth(id),
    prisma.socioProgress.findUnique({ where: { socioId: id } }),
    prisma.socioFlag.findMany({ where: { socioId: id }, orderBy: { createdAt: 'desc' } }),
    prisma.lessonProgress.findMany({ where: { socioId: id }, orderBy: { lessonNumber: 'asc' } }),
    prisma.message.findMany({ where: { socioId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);

  const healthColor =
    health.status === 'RED' ? 'bg-red-500' : health.status === 'YELLOW' ? 'bg-yellow-400' : 'bg-green-400';

  return (
    <div>
      <Link href="/admin/socios" className="text-sm text-blue-600 hover:underline">
        &larr; Back to socios
      </Link>

      {/* Header */}
      <div className="mt-4 mb-6 flex items-center gap-4">
        <span className={`w-4 h-4 rounded-full ${healthColor}`} />
        <h2 className="text-2xl font-bold text-gray-900">
          {socio.name ?? 'No name'}
        </h2>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
          socio.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
        }`}>
          {socio.status}
        </span>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <InfoCard label="Business" value={socio.businessName ?? '-'} />
        <InfoCard label="Channel" value={`${socio.channelType} / ${socio.externalId}`} />
        <InfoCard label="Current Lesson" value={String(progress?.currentLessonNumber ?? 1)} />
        <InfoCard label="Mentor" value={socio.mentor?.name ?? 'Unassigned'} />
        <InfoCard label="Last Interaction" value={
          progress?.lastInteractionAt
            ? new Date(progress.lastInteractionAt).toLocaleString()
            : 'Never'
        } />
        <InfoCard label="Completed Lessons" value={String(progress?.completedLessons?.length ?? 0)} />
        <InfoCard label="Language" value={socio.language} />
        <InfoCard label="Reminders Sent" value={String(progress?.remindersSent ?? 0)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Flags */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Flags ({flags.length})</h3>
          {flags.length === 0 ? (
            <p className="text-sm text-gray-500">No flags.</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {flags.map((f) => (
                <div key={f.id} className={`p-2 rounded text-sm ${
                  f.level === 'RED' ? 'bg-red-50 text-red-800' : 'bg-yellow-50 text-yellow-800'
                } ${f.resolved ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{f.level}</span>
                    {f.resolved && <span className="text-xs">(resolved)</span>}
                  </div>
                  <div className="text-xs mt-0.5">{f.reason}</div>
                  <div className="text-xs opacity-60 mt-0.5">
                    {new Date(f.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Lesson Progress */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Lesson Progress</h3>
          {lessonProgress.length === 0 ? (
            <p className="text-sm text-gray-500">No progress recorded.</p>
          ) : (
            <div className="space-y-2">
              {lessonProgress.map((lp) => (
                <div key={lp.id} className="flex items-center gap-3 text-sm">
                  <span className="font-medium text-gray-700 w-20">Lesson {lp.lessonNumber}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        lp.completedAt ? 'bg-green-500' : 'bg-blue-400'
                      }`}
                      style={{ width: `${Math.min(100, (lp.understanding ?? 0) * 10)}%` }}
                    />
                  </div>
                  <span className="text-gray-500 w-8 text-right">
                    {lp.understanding ?? '-'}
                  </span>
                  {lp.completedAt && (
                    <span className="text-xs text-green-600">Done</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Prompt Overrides */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Prompt Overrides</h3>
          {socio.promptOverrides ? (
            <pre className="text-sm text-gray-600 whitespace-pre-wrap">
              {JSON.stringify(socio.promptOverrides, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-gray-500">Default settings.</p>
          )}
        </div>

        {/* Recent conversation */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-3">
            Recent Messages ({messages.length})
          </h3>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {messages.reverse().map((m) => (
              <div
                key={m.id}
                className={`p-2 rounded text-sm ${
                  m.role === 'user'
                    ? 'bg-blue-50 text-blue-900'
                    : m.role === 'assistant'
                    ? 'bg-gray-50 text-gray-800'
                    : 'bg-yellow-50 text-yellow-800'
                }`}
              >
                <div className="text-xs font-medium opacity-60 mb-0.5">
                  {m.role === 'user' ? 'Socio' : m.role === 'assistant' ? 'AI' : m.role}
                  {' - '}
                  {new Date(m.createdAt).toLocaleString()}
                </div>
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium text-gray-900 mt-0.5 truncate">{value}</div>
    </div>
  );
}
