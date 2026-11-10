import { safetyConfig } from "./safety";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { HttpError } from "../access";
import { requestProviders } from "../providers";
import { agentPrompt } from "./prompt";
import { definitions as baseDefinitions } from "./tools";
import { memoryDefinitions } from "../memory-options";
const definitions = [...baseDefinitions, ...memoryDefinitions];
import type { ModelSession, Turn, Limits } from "./types";

export function agentConfig(req: Request, requested?: string) {
  const safety = safetyConfig();
  const clean = new Request(req.url, {
    headers: {
      "x-forge-provider": req.headers.get("x-forge-provider") || "auto",
    },
  });
  const config = requestProviders(clean);
  if (!config.provider || config.provider === "local" || config.missing.length)
    throw new HttpError(
      400,
      "Agent mode needs an Anthropic or OpenAI key configured on the server. Personal keys still work in normal chat.",
    );
  const model = requested || config.modelLabel;
  let rates: Record<string, { input: number; output: number; context: number }>;
  try {
    rates = z
      .record(
        z.string(),
        z.object({
          input: z.number().positive(),
          output: z.number().positive(),
          context: z.number().int().min(4096),
        }),
      )
      .parse(JSON.parse(process.env.AGENT_MODEL_BUDGETS || "{}"));
  } catch {
    throw new HttpError(
      503,
      "Agent model budgets need valid server configuration.",
    );
  }
  const rate = rates[model];
  if (
    !rate ||
    ![rate.input, rate.output, rate.context].every(
      (v) => Number.isFinite(v) && v > 0,
    ) ||
    rate.context < 4096
  )
    throw new HttpError(
      400,
      "The server owner must configure a token budget and verified input/output prices for this agent model.",
    );
  if (
    (config.provider === "anthropic" && !model.startsWith("claude-")) ||
    (config.provider === "openai" && !/^(gpt-|o[134])/.test(model))
  )
    throw new HttpError(400, "Choose a model for the selected provider.");
  const limits: Limits = {
    steps: 12,
    milliseconds: 120000,
    tokens: safety.tokens,
    context: Math.min(32000, rate.context),
    cost: safety.cost,
    inputRate: rate.input,
    outputRate: rate.output,
    searchCost: 0.01,
  };
  return { config, model, limits };
}
export function modelSession(
  settings: ReturnType<typeof agentConfig>,
  history: Turn[],
  snapshot?: string,
): ModelSession {
  const { config, model } = settings;
  if (config.provider === "anthropic") {
    const client = new Anthropic({
      apiKey: config.anthropicKey,
      maxRetries: 0,
    });
    const messages: Anthropic.MessageParam[] = snapshot
      ? JSON.parse(snapshot)
      : history.map((m) => ({ ...m }));
    return {
      snapshot: () => JSON.stringify(messages),
      size: () =>
        Buffer.byteLength(
          JSON.stringify(messages) + agentPrompt + JSON.stringify(definitions),
        ) + 1024,
      async next(maxOutput, signal, delta) {
        const stream = client.messages.stream(
          {
            model,
            max_tokens: maxOutput,
            system: agentPrompt,
            messages,
            tool_choice: { type: "auto", disable_parallel_tool_use: true },
            tools: definitions.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters as Anthropic.Tool.InputSchema,
            })),
          },
          { signal },
        );
        stream.on("text", delta);
        const response = await stream.finalMessage();
        messages.push({ role: "assistant", content: response.content });
        return {
          text: response.content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n"),
          calls: response.content.flatMap((c) =>
            c.type === "tool_use"
              ? [{ id: c.id, name: c.name, input: c.input }]
              : [],
          ),
          inputTokens:
            response.usage.input_tokens +
            (response.usage.cache_read_input_tokens || 0) +
            (response.usage.cache_creation_input_tokens || 0),
          outputTokens: response.usage.output_tokens,
          incomplete: response.stop_reason === "max_tokens",
        };
      },
      observe(call, output) {
        messages.push({
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: call.id, content: output },
          ],
        });
      },
    };
  }
  const client = new OpenAI({ apiKey: config.openaiKey, maxRetries: 0 });
  const input: ResponseInputItem[] = snapshot
    ? JSON.parse(snapshot)
    : history.map((m) => ({ ...m }));
  return {
    snapshot: () => JSON.stringify(input),
    size: () =>
      Buffer.byteLength(
        JSON.stringify(input) + agentPrompt + JSON.stringify(definitions),
      ) + 1024,
    async next(maxOutput, signal, delta) {
      const stream = await client.responses.create(
        {
          stream: true,
          model,
          instructions: agentPrompt,
          input,
          store: false,
          include: ["reasoning.encrypted_content"],
          max_output_tokens: maxOutput,
          parallel_tool_calls: false,
          tools: definitions.map((t) => ({
            type: "function",
            name: t.name,
            description: t.description,
            parameters: t.parameters,
            strict: false,
          })),
        },
        { signal },
      );
      let response: OpenAI.Responses.Response | undefined;
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") delta(event.delta);
        if (
          event.type === "response.completed" ||
          event.type === "response.incomplete"
        )
          response = event.response;
        if (event.type === "error" || event.type === "response.failed")
          throw Error("Model response failed.");
      }
      if (!response || !response.usage)
        throw Error("Model stream ended without completion or usage.");
      input.push(
        ...response.output.filter(
          (c) =>
            c.type === "message" ||
            c.type === "function_call" ||
            c.type === "reasoning",
        ),
      );
      return {
        text: response.output
          .filter((c) => c.type === "message")
          .flatMap((c) =>
            c.content.flatMap((v) =>
              v.type === "output_text" ? [v.text] : [],
            ),
          )
          .join("\n"),
        calls: response.output.flatMap((c) =>
          c.type === "function_call"
            ? [
                {
                  id: c.call_id,
                  name: c.name,
                  input: parseArguments(c.arguments),
                },
              ]
            : [],
        ),
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
        incomplete: response.status !== "completed",
      };
    },
    observe(call, output) {
      input.push({ type: "function_call_output", call_id: call.id, output });
    },
  };
}
function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
