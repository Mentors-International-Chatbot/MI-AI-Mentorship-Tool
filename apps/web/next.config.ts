import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // The participant-facing pages moved from /socios to /learners. These keep
    // existing bookmarks, saved links, and anything a mentor pinned working.
    //
    // Permanent (308): the old paths are not coming back, and a permanent
    // redirect lets browsers stop asking. Note that browsers cache 308s
    // aggressively — if these paths are ever reused for something else, that
    // cache is the thing that will bite.
    //
    // Only page routes are listed. The /api/* routes deliberately kept their
    // /socios paths: renaming those would break the mentor API contract and
    // any external caller of it.
    return [
      { source: "/dashboard/socios", destination: "/dashboard/learners", permanent: true },
      { source: "/dashboard/socios/:path*", destination: "/dashboard/learners/:path*", permanent: true },
      { source: "/admin/socios", destination: "/admin/learners", permanent: true },
      { source: "/admin/socios/:path*", destination: "/admin/learners/:path*", permanent: true },
      { source: "/admin/socio-feedback", destination: "/admin/learner-feedback", permanent: true },
    ];
  },
};

export default nextConfig;
