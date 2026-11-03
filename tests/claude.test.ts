import assert from "node:assert/strict";
import test from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { generateArtifact } from "../src/lib/claude";
import { ArtifactParser } from "../src/lib/artifact-parser";

test("the official Anthropic client streams file contents into the artifact parser", async () => {
  const parts = [
    '<artifact id="a" title="Demo"><action type="file" filePath="src/page.tsx">',
    "export default function Page(){return <main>Hello</main>}",
    "</action></artifact>",
  ];
  const client = new Anthropic({
    apiKey: "test-only",
    fetch: async (url, init) => {
      assert.equal(new URL(String(url)).pathname, "/v1/messages");
      const request = JSON.parse(String(init?.body));
      assert.equal(request.stream, true);
      assert.match(request.messages[0].content, /Build a website/);
      const response = parts.map(text => "event: content_block_delta\ndata: " +
        JSON.stringify({type:"content_block_delta", index:0, delta:{type:"text_delta",text}}) + "\n\n").join("");
      return new Response(response, {headers: {"Content-Type":"text/event-stream"}});
    },
  });
  let file = "", complete = false;
  const parser = new ArtifactParser({onFileChunk: (_path, text) => file += text, onFileComplete: () => complete = true});
  for await (const token of generateArtifact(client, {request:"Build a website", files:{}, attempt:0, diagnostic:""}, new AbortController().signal)) parser.push(token);
  parser.finish();
  assert.equal(file, parts[1]);
  assert.equal(complete, true);
});
