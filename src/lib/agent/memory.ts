import { z } from "zod";
import { db } from "../db";
import { preferenceSchema } from "../memory-options";
import { execute } from "./tools";

export function memoryTools(ownerId: string): typeof execute {
  return async (name, input, signal) => {
    if (name !== "save_memory" && name !== "recall_memory")
      return execute(name, input, signal);
    signal.throwIfAborted();
    const unavailable = {
      text: "Preference memory is off. The user can enable it in Settings. Nothing was saved or recalled.",
      sources: [],
      failed: true,
      maxOutput: 2000,
    };
    const enabled = await db.user.findUnique({
      where: { id: ownerId },
      select: { memoryEnabled: true },
    });
    if (!enabled?.memoryEnabled) return unavailable;
    if (name === "save_memory") {
      const parsed = preferenceSchema.safeParse(input);
      if (!parsed.success)
        return {
          ...unavailable,
          text: "Only the listed language, tone and detail preferences are allowed. No private facts or free text can be saved.",
        };
      return {
        text:
          "Preference proposed, not saved. The user must review and click Save preference. " +
          JSON.stringify(parsed.data),
        sources: [],
        failed: false,
        maxOutput: 2000,
      };
    }
    if (!z.object({}).strict().safeParse(input).success)
      return {
        ...unavailable,
        text: "recall_memory takes an empty object {}.",
      };
    const memories = await db.preferenceMemory.findMany({
      where: {
        ownerId,
        expiresAt: { gt: new Date() },
        owner: { memoryEnabled: true },
      },
      orderBy: { category: "asc" },
      select: { category: true, value: true },
    });
    return {
      text: JSON.stringify({ preferences: memories }),
      sources: [],
      failed: false,
      maxOutput: 2000,
    };
  };
}
