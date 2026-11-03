import OpenAI from "openai";
import { ProviderFailure } from "./engine";
export async function* openAIText(
  client: OpenAI,
  model: string,
  instructions: string,
  input: string,
  signal: AbortSignal,
  json = false,
) {
  try {
    const stream = await client.responses.create(
      {
        model,
        instructions,
        input,
        store: false,
        stream: true,
        max_output_tokens: json ? 3000 : 16000,
        ...(json ? { text: { format: { type: "json_object" as const } } } : {}),
      },
      { signal },
    );
    let complete = false;
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") yield event.delta;
      else if (event.type === "response.completed") complete = true;
      else if (
        event.type === "error" ||
        event.type === "response.failed" ||
        event.type === "response.incomplete"
      )
        throw new ProviderFailure(
          "OpenAI could not complete this generation. Check the model, available credit and output limit.",
        );
    }
    if (!complete)
      throw new ProviderFailure(
        "OpenAI closed the response before it was complete.",
      );
  } catch (e) {
    signal.throwIfAborted();
    if (e instanceof ProviderFailure) throw e;
    const status = e instanceof OpenAI.APIError ? e.status : undefined;
    throw new ProviderFailure(
      "OpenAI request failed" +
        (status ? " (HTTP " + status + ")" : "") +
        ". Check the provider key, model and account limits.",
    );
  }
}
