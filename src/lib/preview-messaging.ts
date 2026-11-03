import { useEffect, type RefObject } from "react";
export function useInstantData(
  frame: RefObject<HTMLIFrameElement | null>,
  url: string,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    const preview = new URL(url, location.origin);
    if (
      preview.origin !== location.origin ||
      preview.pathname !== "/api/instant/preview"
    )
      return;
    const projectId = preview.searchParams.get("projectId"),
      sandboxId = preview.searchParams.get("sandboxId");
    let active = true,
      inflight = 0;
    const abort = new AbortController();
    async function receive(event: MessageEvent) {
      const win = frame.current?.contentWindow,
        m = event.data;
      if (
        !win ||
        event.source !== win ||
        event.origin !== "null" ||
        !m ||
        m.kind !== "forge-data" ||
        typeof m.id !== "string" ||
        m.id.length > 80
      )
        return;
      if (
        typeof m.path !== "string" ||
        !/^\/api\/data\/[a-zA-Z][\w]{0,39}(?:\/[\w-]{1,80})?\/?$/.test(
          m.path,
        ) ||
        !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(m.method)
      )
        return;
      const reply = (status: number, body: unknown) => {
        if (active && frame.current?.contentWindow === win)
          win.postMessage(
            { kind: "forge-data-result", id: m.id, status, body },
            "*",
          );
      };
      if (inflight >= 12) {
        reply(429, { error: "Too many simultaneous requests." });
        return;
      }
      inflight++;
      try {
        const data = JSON.stringify({
          projectId,
          sandboxId,
          method: m.method,
          path: m.path,
          body: m.body,
        });
        if (data.length > 11900) {
          reply(413, { error: "Record is too large." });
          return;
        }
        const res = await fetch("/api/instant/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: data,
          signal: abort.signal,
          redirect: "error",
        });
        reply(res.status, await res.json());
      } catch {
        reply(500, { error: "Data request failed." });
      } finally {
        inflight--;
      }
    }
    window.addEventListener("message", receive);
    return () => {
      active = false;
      abort.abort();
      window.removeEventListener("message", receive);
    };
  }, [enabled, frame, url]);
}
