import { ProviderFailure } from "./engine";
let preferCpuUntil = 0;
export async function* localChat(
  system: string,
  message: string,
  signal: AbortSignal,
  format?: object,
): AsyncGenerator<string> {
  const model = process.env.MEROVA_LOCAL_MODEL;
  if (!model || model.endsWith(":cloud"))
    throw new ProviderFailure("Select an installed local Ollama model.");
  let response: Response;
  try {
    const request = (cpuOnly = false) =>
      fetch("http://127.0.0.1:11434/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: true,
          think: false,
          format,
          messages: [
            { role: "system", content: system },
            { role: "user", content: message },
          ],
          options: {
            temperature: 0.2,
            num_ctx: cpuOnly ? 8192 : 12288,
            ...(cpuOnly ? { num_gpu: 0 } : {}),
            num_predict: format ? 1600 : 6500,
          },
        }),
        signal,
        redirect: "error",
      });
    const cpuPreferred = Date.now() < preferCpuUntil;
    response = await request(cpuPreferred);
    if (!cpuPreferred && response.status >= 500) {
      await response.body?.cancel();
      signal.throwIfAborted();
      response = await request(true);
      if (response.ok) preferCpuUntil = Date.now() + 10 * 60_000;
    }
  } catch {
    signal.throwIfAborted();
    throw new ProviderFailure("Cannot reach Ollama on this computer.");
  }
  if (!response.ok || !response.body)
    throw new ProviderFailure("Ollama could not load the selected model.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = "",
    finished = false;
  try {
    while (!finished) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = pending.split("\n");
      pending = chunk.done ? "" : lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        const part = JSON.parse(line);
        if (part.error) throw new ProviderFailure("Local generation failed.");
        if (part.message?.content) yield String(part.message.content);
        if (part.done) finished = true;
      }
      if (chunk.done) break;
    }
    if (!finished)
      throw new ProviderFailure("Local model stream ended unexpectedly.");
  } finally {
    await reader.cancel().catch(() => {});
  }
}
