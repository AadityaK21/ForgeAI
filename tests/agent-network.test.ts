import { test, mock } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { publicPage } from "../src/lib/agent/network";

test("page transport rejects mixed DNS answers, pins public DNS and validates redirects", async () => {
  let addresses = [{ address: "8.8.8.8", family: 4 }],
    requests = 0,
    redirect = false,
    large = false;
  mock.method(dns, "lookup", async () => addresses);
  const transport = (
    _url: URL,
    options: https.RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => {
    requests++;
    assert.equal(options.family, 4);
    options.lookup!("page.example", {}, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(address, "8.8.8.8");
      assert.equal(family, 4);
    });
    const response = Readable.from([
      large ? Buffer.alloc(1_000_001) : Buffer.from("public text"),
    ]) as IncomingMessage;
    response.statusCode = redirect ? 302 : 200;
    response.headers = redirect
      ? { location: "http://169.254.169.254/latest/meta-data" }
      : { "content-type": "text/plain" };
    queueMicrotask(() => callback(response));
    return new EventEmitter();
  };
  mock.method(https, "get", transport as unknown as typeof https.get);
  try {
    const signal = new AbortController().signal;
    addresses = [...addresses, { address: "10.0.0.1", family: 4 }];
    await assert.rejects(
      publicPage("https://page.example", signal),
      /public addresses/,
    );
    assert.equal(requests, 0);
    addresses = addresses.slice(0, 1);
    assert.equal(
      (await publicPage("https://page.example", signal)).text,
      "public text",
    );
    redirect = true;
    await assert.rejects(
      publicPage("https://page.example", signal),
      /public HTTP/,
    );
    assert.equal(requests, 2, "redirect to metadata never reaches transport");
    redirect = false;
    large = true;
    await assert.rejects(publicPage("https://page.example", signal), /1 MB/);
  } finally {
    mock.restoreAll();
  }
});

test("redirect DNS rebinding, redirect caps and non-text MIME types fail closed", async () => {
  let lookups = 0,
    requests = 0,
    mode = "rebind";
  mock.method(dns, "lookup", async () => {
    lookups++;
    return [
      {
        address: mode === "rebind" && lookups > 1 ? "127.0.0.1" : "8.8.8.8",
        family: 4,
      },
    ];
  });
  mock.method(https, "get", ((
    _url: URL,
    options: https.RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => {
    requests++;
    // There is no second DNS lookup at connect time: the exact checked public address is used.
    options.lookup!("page.example", {}, (_error, address) =>
      assert.equal(address, "8.8.8.8"),
    );
    const response = Readable.from([Buffer.from("text")]) as IncomingMessage;
    response.statusCode = mode === "rebind" || mode === "redirects" ? 302 : 200;
    response.headers =
      response.statusCode === 302
        ? { location: "https://page.example/next" }
        : { "content-type": mode };
    queueMicrotask(() => callback(response));
    return new EventEmitter();
  }) as unknown as typeof https.get);
  try {
    await assert.rejects(
      publicPage("https://page.example", new AbortController().signal),
      /public addresses/,
    );
    assert.equal(requests, 1, "rebound address was never requested");
    mode = "redirects";
    requests = 0;
    await assert.rejects(
      publicPage("https://page.example", new AbortController().signal),
      /Too many redirects/,
    );
    assert.equal(requests, 5);
    for (const mime of [
      "application/json",
      "text/html-malicious",
      "application/octet-stream",
      "image/svg+xml",
      "",
    ]) {
      mode = mime;
      await assert.rejects(
        publicPage("https://page.example", new AbortController().signal),
        /not readable text/,
      );
    }
    for (const mime of ["text/html; charset=utf-8", "text/plain"]) {
      mode = mime;
      assert.equal(
        (await publicPage("https://page.example", new AbortController().signal))
          .text,
        "text",
      );
    }
  } finally {
    mock.restoreAll();
  }
});

test("aborting a stalled DNS resolution returns promptly without opening a socket", async () => {
  mock.method(dns, "lookup", () => new Promise(() => {}));
  mock.method(https, "get", () =>
    assert.fail("no socket before DNS validation"),
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10);
  try {
    await assert.rejects(
      publicPage("https://page.example", controller.signal),
      /stopped/,
    );
  } finally {
    clearTimeout(timer);
    mock.restoreAll();
  }
});
