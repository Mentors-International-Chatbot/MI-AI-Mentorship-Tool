# Canvas LTI 1.3 setup

1. Apply the Prisma migration and publish the AI Essentials cartridge:

   ```bash
   npx prisma migrate deploy
   npm run import:ai-essentials -- --organization <organization-slug> --publish
   ```

2. Configure `NEXT_PUBLIC_APP_URL`, `LTI_PRIVATE_JWK`, `CRON_SECRET`, and
   `CANVAS_FRAME_ANCESTORS` as described in `.env.example`. The private JWK must
   be an RSA signing key with a stable `kid` and `alg: "RS256"`; OCI publishes
   only its public fields from `/api/lti/jwks`.

3. In Canvas, use the JSON returned by `/api/lti/configuration` for the LTI
   Developer Key. Enable the AGS score scope shown in that configuration.

4. As an OCI administrator, register the Canvas platform, deployment, and
   course context with `POST /api/admin/lti/registrations`. The request body is:

   ```json
   {
     "organizationId": "...",
     "issuer": "https://canvas.instructure.com",
     "clientId": "...",
     "authorizationUrl": "https://<canvas-host>/api/lti/authorize_redirect",
     "tokenUrl": "https://<canvas-host>/login/oauth2/token",
     "jwksUrl": "https://<canvas-host>/api/lti/security/jwks",
     "deploymentId": "...",
     "contextId": "<Canvas course id>",
     "programVersionId": "<published AI Essentials version id>",
     "cohortId": "<OCI cohort id>",
     "title": "Optional course title"
   }
   ```

The registration endpoint rejects cross-tenant objects and courses that are
not published Canvas-enabled player courses. Learners are provisioned on first
launch; instructors receive the context-scoped monitoring and Deep Linking
surfaces. Grade retries run from `/api/cron/lti-grades` and stop after five
attempts unless an instructor or administrator manually resets a delivery.
