import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createInstantWorker,
  instantStarter,
  readInstantHtml,
} from "../src/lib/instant-worker";
import { openStore } from "../src/templates/instant/store.cjs";
test("instant projects compile React and persist validated CRUD without running generated shell code", async () => {
  const projectId = "qa-" + randomUUID(),
    box = await createInstantWorker(
      projectId,
      () => {},
      new AbortController().signal,
    );
  try {
    const files = instantStarter({ files: {}, install: "", start: "" }).files;
    const schema = {
      tables: {
        leads: {
          fields: { name: "string" },
          seed: [{ id: "one", name: "First" }],
        },
      },
    };
    Object.assign(files, {
      "forge.schema.json": JSON.stringify(schema),
      "src/App.tsx":
        "export default function App({path}:{path:string}){return <main><a href='#/leads'>Leads</a>{path}</main>}",
    });
    for (const [name, content] of Object.entries(files))
      await box.worker.write(name, content);
    await assert.rejects(box.worker.write("../outside", "x"));
    await box.worker.verify();
    await box.worker.start("forge preview");
    assert.match(await readInstantHtml(projectId, box.id), /forge-data-result/);
    await assert.rejects(box.worker.run("touch unsafe"));
    await box.worker.write(
      "src/App.tsx",
      "export default function App(){const broken:number='x';return <p>{broken}</p>}",
    );
    await assert.rejects(box.worker.verify(), /TS2322/);
    const db = openStore(":memory:", schema);
    try {
      assert.equal(db.request("GET", "/api/data/leads").body.length, 1);
      assert.equal(
        db.request("POST", "/api/data/leads", { name: 99 }).status,
        400,
      );
      const created = db.request("POST", "/api/data/leads", { name: "Second" });
      assert.equal(created.status, 201);
      assert.equal(
        db.request("PATCH", "/api/data/leads/" + created.body.id, {
          name: "Next",
        }).body.name,
        "Next",
      );
      assert.equal(
        db.request("DELETE", "/api/data/leads/" + created.body.id).status,
        200,
      );
    } finally {
      db.close();
    }
  } finally {
    await box.release(false);
  }
});
