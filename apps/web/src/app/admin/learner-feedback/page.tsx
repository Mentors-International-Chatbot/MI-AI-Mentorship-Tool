import Link from 'next/link';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AdminSocioFeedbackPage() {
  const rows = await prisma.socioFeedback.findMany({
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: {
      socio: { select: { id: true, name: true, businessName: true } },
    },
  });

  const rated = rows.filter((r) => r.rating != null);
  const avg =
    rated.length > 0
      ? (rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length).toFixed(1)
      : null;

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Learner satisfaction (all)</h2>
      <p className="text-sm text-gray-500 mb-4">
        Aggregate view of all ratings. For each learner&apos;s latest score and full history, use{' '}
        <Link href="/admin/learners" className="text-blue-600 hover:underline">
          Admin → Learners
        </Link>{' '}
        and open the learner detail page.
      </p>
      <div className="flex flex-wrap gap-6 mb-6 text-sm">
        <div>
          <span className="text-gray-500">Total records</span>{' '}
          <span className="font-semibold text-gray-900">{rows.length}</span>
        </div>
        <div>
          <span className="text-gray-500">With numeric rating</span>{' '}
          <span className="font-semibold text-gray-900">{rated.length}</span>
        </div>
        {avg != null && (
          <div>
            <span className="text-gray-500">Average (1–10)</span>{' '}
            <span className="font-semibold text-gray-900">{avg}</span>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-gray-400 text-sm">No feedback yet.</p>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Learner</th>
                <th className="px-4 py-3">Lesson #</th>
                <th className="px-4 py-3">Rating</th>
                <th className="px-4 py-3">Comment</th>
                <th className="px-4 py-3 w-24"> </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {r.createdAt.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {r.socio.name ?? '—'}
                    {r.socio.businessName ? (
                      <span className="block text-xs font-normal text-gray-500">
                        {r.socio.businessName}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{r.lessonNum}</td>
                  <td className="px-4 py-3">{r.rating ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-700 max-w-md whitespace-pre-wrap break-words">
                    {r.comment ?? '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link
                      href={`/admin/learners/${r.socio.id}`}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      Learner detail
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
