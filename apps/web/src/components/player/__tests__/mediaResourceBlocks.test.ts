import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/player/LessonPlayer.tsx"),
  "utf8",
);

describe("media and resource lesson blocks", () => {
  it("models every schema variant without inventing a response gate", () => {
    expect(source).toMatch(/type Media = BlockBase & \{ blockType: "media"; kind: string; config: Record<string, unknown>; caption\?: string \}/);
    expect(source).toMatch(/type: "weblink"; url: string; label: string; description\?: string/);
    expect(source).toMatch(/type: "textbook_reference"; title\?: string; isbn\?: string; chapter\?: string; page\?: string; callout\?: string/);
    expect(source).toMatch(/type: "mcp_connector"; connector: string; context\?: string/);
    expect(source).not.toMatch(/requiresMedia|requiresResource/);
  });

  it("renders media visibly, including a kind-specific placeholder and markdown caption", () => {
    expect(source).toMatch(/function MediaBlock/);
    expect(source).toMatch(/<ReactMarkdown remarkPlugins=\{\[remarkGfm\]\}>\{block\.caption\}<\/ReactMarkdown>/);
    expect(source).toMatch(/This \{kind\} does not have an in-player preview yet\./);
  });

  it("renders every resource variant and keeps external links safe", () => {
    expect(source).toMatch(/resource\.type === "weblink"/);
    expect(source).toMatch(/resource\.type === "textbook_reference"/);
    expect(source).toMatch(/<h2>Connected resource<\/h2>/);
    expect(source).toMatch(/target="_blank" rel="noopener noreferrer"/);
    expect(source).toMatch(/resource\.description && <ReactMarkdown remarkPlugins=\{\[remarkGfm\]\}>\{resource\.description\}<\/ReactMarkdown>/);
    expect(source).toMatch(/resource\.callout && <ReactMarkdown remarkPlugins=\{\[remarkGfm\]\}>\{resource\.callout\}<\/ReactMarkdown>/);
  });

  it("advances both as read-and-continue blocks through the existing advance path", () => {
    expect(source).toMatch(/current\.blockType === "media"[\s\S]*?<button disabled=\{busy\} onClick=\{\(\) => advance\(\{ acknowledged: true \}\)\}>\{primaryLabel\(question\)\}<\/button>/);
    expect(source).toMatch(/current\.blockType === "resource"[\s\S]*?<button disabled=\{busy\} onClick=\{\(\) => advance\(\{ acknowledged: true \}\)\}>\{primaryLabel\(question\)\}<\/button>/);
  });

  it("derives refresh-safe history from authored fields for both block types", () => {
    const helper = source.slice(source.indexOf("export function historyContent"), source.indexOf("function MediaBlock"));
    expect(helper).toMatch(/block\.blockType === "media"/);
    expect(helper).toMatch(/media\.kind, media\.caption/);
    expect(helper).toMatch(/block\.blockType === "resource"/);
    expect(helper).toMatch(/resource\.label, resource\.description/);
    expect(helper).toMatch(/resource\.title, resource\.isbn, resource\.chapter, resource\.page, resource\.callout/);
    expect(helper).toMatch(/resource\.connector, resource\.context/);
    expect(helper).not.toMatch(/api\/chat|summary/i);
  });
});
