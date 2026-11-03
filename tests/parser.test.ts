import test from "node:test";
import assert from "node:assert/strict";
import { ArtifactParser } from "../src/lib/artifact-parser";
test("one-character chunks, CDATA escaping and raw JSX preserve file bytes and action order", () => {
  const events: string[] = [];
  let content = "";
  const p = new ArtifactParser({
    onFileStart: (n) => events.push(n),
    onFileChunk: (_, text) => (content += text),
    onFileComplete: (n) => events.push(n),
    onShellCommand: (c) => events.push(c),
    onStartServer: (c) => events.push(c),
  });
  const xml =
    '<artifact id="a" title="Site"><action type="file" filePath="src/page.tsx"><![CDATA[x</action>]]]]><![CDATA[>Ω]]></action><action type="file" filePath="style.css">\n.x { color:red; }\n</action><action type="shell">npm install</action><action type="start">npm run dev</action></artifact>';
  for (const ch of xml) p.push(ch);
  p.finish();
  assert.equal(content, "x</action>]]>Ω\n.x { color:red; }\n");
  assert.deepEqual(events, [
    "src/page.tsx",
    "src/page.tsx",
    "style.css",
    "style.css",
    "npm install",
    "npm run dev",
  ]);
});
test("file chunks arrive before closing tag", () => {
  let seen = "";
  const p = new ArtifactParser({ onFileChunk: (_, s) => (seen += s) });
  p.push(
    '<artifact id="x" title="Y"><action type="file" filePath="file.ts">const a=1;',
  );
  assert.equal(seen, "const a=1;");
  assert.throws(() => p.finish(), /Incomplete/);
});
test("rejects traversal, malformed streams and commands after start", () => {
  for (const path of [
    "../etc/passwd",
    "/tmp/a",
    "c:\\foo",
    "a//b",
    ".git/config",
    "node_modules/a",
    "",
  ]) {
    const p = new ArtifactParser();
    assert.throws(() =>
      p.push(
        '<artifact id="x" title="Y"><action type="file" filePath="' +
          path +
          '">x</action></artifact>',
      ),
    );
  }
  const p = new ArtifactParser();
  assert.throws(() =>
    p.push(
      '<artifact id="x" title="A"><action type="start">run</action><action type="shell">late</action></artifact>',
    ),
  );
});
