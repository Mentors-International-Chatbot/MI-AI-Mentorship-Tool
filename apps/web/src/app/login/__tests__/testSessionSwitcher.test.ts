import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src", "app", "login", "page.tsx"), "utf8");

describe("development test-session switcher", () => {
  it("requires the explicit test query and server-side flag", () => {
    expect(source).toContain("params.test === '1'");
    expect(source).toContain("process.env.ENABLE_TEST_LOGIN === 'true'");
  });

  it("cannot bypass the authenticated-login redirect in production", () => {
    expect(source).toContain("process.env.NODE_ENV === 'production'");
    expect(source).toContain("if (session && !testSessionSwitcher)");
  });
});
