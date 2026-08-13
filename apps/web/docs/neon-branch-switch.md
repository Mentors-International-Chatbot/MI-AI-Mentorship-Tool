# Neon branch switching

Browser sessions do not transfer between Neon branches. The signed cookie may
remain valid while its user ID exists only on the previous branch.

Whenever `DATABASE_URL` changes to another Neon branch:

1. Stop the development server.
2. Clear the `mi_session` cookie for the local site, or open the new branch in
   an incognito window.
3. Start the server with the new branch URL and sign in again.

`/join` now distinguishes these states:

- `401 no_session`: there is no valid session cookie.
- `409 session_database_mismatch`: the cookie is valid, but its database user
  is absent. Clear the session and sign in on the current branch.
- `enrollmentIssue: no-published-course`: the learner has a course key, but the
  current branch has no published version.
- `enrollmentIssue: not-enrolled`: a published player version exists, but the
  learner has no matching active enrollment.

The `/api/auth/me` and `/api/auth/curriculum` routes both exist. A historical
404 with `Socio not found` was an application response caused by the stale
cross-branch cookie, not a missing Next.js route.
