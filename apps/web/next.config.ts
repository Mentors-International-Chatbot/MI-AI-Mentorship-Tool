import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  // The repository intentionally has a root package for the content converter
  // and an app package for Next. Declare the app root instead of asking Next to
  // guess from two legitimate lockfiles.
  turbopack: { root: resolve(__dirname) },
  async headers() {
    const ancestors = process.env.CANVAS_FRAME_ANCESTORS ?? "https://byu.instructure.com https://byu.beta.instructure.com https://byu.test.instructure.com";
    return [
      { source: "/learn/:path*", headers: [{ key: "Content-Security-Policy", value: `frame-ancestors 'self' ${ancestors}` }] },
      { source: "/lti/:path*", headers: [{ key: "Content-Security-Policy", value: `frame-ancestors 'self' ${ancestors}` }] },
    ];
  },
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
