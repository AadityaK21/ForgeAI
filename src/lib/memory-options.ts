import { z } from "zod";

// Closed values deliberately exclude arbitrary text, identifiers and secrets.
export const memoryOptions = {
  language: [
    "English",
    "Hindi",
    "Spanish",
    "French",
    "German",
    "Portuguese",
    "Japanese",
    "Korean",
  ],
  tone: ["Friendly", "Professional", "Direct"],
  detail: ["Concise", "Balanced", "Detailed"],
} as const;
export type MemoryCategory = keyof typeof memoryOptions;
export const preferenceSchema = z.discriminatedUnion("category", [
  z
    .object({
      category: z.literal("language"),
      value: z.enum(memoryOptions.language),
    })
    .strict(),
  z
    .object({ category: z.literal("tone"), value: z.enum(memoryOptions.tone) })
    .strict(),
  z
    .object({
      category: z.literal("detail"),
      value: z.enum(memoryOptions.detail),
    })
    .strict(),
]);
export const memoryDefinitions = [
  {
    name: "recall_memory",
    description:
      "Read the signed-in user's approved language, tone and response-length preferences. Use only when relevant; not a source of facts. Input {}. Disabled memory returns no preferences.",
    parameters: z.toJSONSchema(z.object({}).strict()),
  },
  {
    name: "save_memory",
    description:
      'Propose a preference only when the user explicitly asks you to remember it. This does NOT save anything: the user must click Save preference in the tool card. Input {"category":"tone","value":"Friendly"}. Only the listed language, tone and detail values are accepted. Never submit private facts, health data, account numbers, IDs or secrets.',
    parameters: z.toJSONSchema(
      z
        .object({
          category: z.enum(["language", "tone", "detail"]),
          value: z.enum([
            ...memoryOptions.language,
            ...memoryOptions.tone,
            ...memoryOptions.detail,
          ]),
        })
        .strict(),
    ),
  },
];
