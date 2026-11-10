import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";

export function publicAddress(address: string) {
  try {
    const ip = ipaddr.process(address);
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export function publicUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "80" && url.port !== "443") ||
    host === "localhost" ||
    /\.(localhost|local|internal|test|invalid)$/.test(host) ||
    (ipaddr.isValid(host) && !publicAddress(host))
  )
    throw Error("Only public HTTP or HTTPS pages are allowed.");
  url.hash = "";
  return url;
}
export async function publicPage(
  value: string,
  signal: AbortSignal,
  redirects = 0,
): Promise<{ url: string; text: string; type: string }> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
  bounded.throwIfAborted();
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([
      readPublicPage(value, bounded, redirects),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(Error("Page request timed out or was stopped."));
        bounded.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    bounded.removeEventListener("abort", onAbort);
  }
}
async function readPublicPage(
  value: string,
  signal: AbortSignal,
  redirects = 0,
): Promise<{ url: string; text: string; type: string }> {
  signal.throwIfAborted();
  if (redirects > 4) throw Error("Too many redirects.");
  const url = publicUrl(value);
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), {
    all: true,
  });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw Error("This host does not resolve to public addresses.");
  const address = addresses[0];
  const result = await new Promise<{
    status: number;
    location?: string;
    text: string;
    type: string;
  }>((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.get(
      url,
      {
        signal,
        agent: false,
        family: address.family,
        // Pin the validated address. The original hostname still supplies Host and TLS SNI.
        lookup: (_host, _options, callback) =>
          callback(null, address.address, address.family),
        headers: {
          Accept: "text/html,text/plain",
          "Accept-Encoding": "identity",
          "User-Agent": "MerovaAI/1.0",
        },
      },
      (response) => {
        const status = response.statusCode || 500;
        if (status >= 300 && status < 400) {
          response.destroy();
          resolve({
            status,
            location: response.headers.location,
            text: "",
            type: "",
          });
          return;
        }
        const type = response.headers["content-type"] || "";
        if (status !== 200 || !/^text\/(html|plain)(?:\s*;|$)/i.test(type)) {
          response.destroy();
          reject(Error("The page is unavailable or is not readable text."));
          return;
        }
        if (
          response.headers["content-encoding"] &&
          response.headers["content-encoding"] !== "identity"
        ) {
          response.destroy();
          reject(Error("Compressed page responses are not supported."));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1_000_000) {
            response.destroy(Error("Page exceeds the 1 MB limit."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            status,
            type,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
  });
  if (result.status >= 300 && result.status < 400) {
    if (!result.location) throw Error("Redirect has no destination.");
    return readPublicPage(
      new URL(result.location, url).href,
      signal,
      redirects + 1,
    );
  }
  return { url: url.href, text: result.text, type: result.type };
}
