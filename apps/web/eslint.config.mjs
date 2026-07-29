import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 2 Tenant Isolation: Ban raw prisma calls outside repo layer
  // ═══════════════════════════════════════════════════════════════════════════
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: [
      // Repo layer is allowed to use prisma directly
      "src/lib/repo/**",
      // DB singleton export is allowed
      "src/lib/db.ts",
      // Journey package layer handles curriculum import/export (read-only shared content)
      "src/lib/journey-package/**",
      // Lesson service reads shared curriculum content (not tenant-scoped)
      "src/lib/lessons/db-lesson-service.ts",
      // Test files may mock prisma
      "src/**/__tests__/**",
      // Admin routes are system-wide operations (user mgmt, config, analytics, prompts)
      "src/app/api/admin/**",
      "src/app/admin/**",
      // Auth routes handle global user authentication
      "src/app/api/auth/**",
      // Config service manages program-wide settings
      "src/lib/config/**",
      // Sensing service has specialized EMA logic intertwined with state updates
      "src/lib/ai/sensing/**",
      // Summary generation reads multiple tables for context assembly
      "src/lib/summary/**",
      // AI invocation tracing is an observability sink, not tenant data: it
      // only ever inserts into ai_invocations and swallows its own failures
      "src/lib/ai/trace/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Match: prisma.<model>.<method>() or prisma.<model>.* (any property access)
          selector: "MemberExpression[object.name='prisma']",
          message:
            "Direct prisma.* calls are banned outside the repo layer. " +
            "Use repo (for legacy Socio flows) or tenantRepo (for Phase 1 domain models) instead. " +
            "This ensures tenant isolation is enforced at the app layer. " +
            "See: MI_Platform_Abstraction_Plan_v1.md Phase 2.",
        },
        {
          // Match: prisma.$transaction, prisma.$queryRaw, etc.
          selector: "MemberExpression[object.name='prisma'][property.name=/^\\$/]",
          message:
            "Direct prisma.$* methods are banned outside the repo layer. " +
            "All database operations must go through the repo layer for tenant isolation.",
        },
      ],
    },
  },
]);

export default eslintConfig;
