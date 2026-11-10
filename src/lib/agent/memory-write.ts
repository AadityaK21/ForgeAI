import type { Prisma } from "@prisma/client";
import { preferenceSchema } from "../memory-options";
import { HttpError } from "../access";

export async function savePreference(
  tx: Prisma.TransactionClient,
  ownerId: string,
  input: unknown,
  source: string,
) {
  const parsed = preferenceSchema.safeParse(input);
  if (!parsed.success)
    throw new HttpError(
      400,
      "Choose a supported preference. Private facts and free text cannot be saved.",
    );
  const owner = await tx.user.findUnique({ where: { id: ownerId } });
  if (!owner?.memoryEnabled)
    throw new HttpError(
      409,
      "Preference memory is off. Enable it in Settings first.",
    );
  const { category, value } = parsed.data;
  const where = { ownerId_category: { ownerId, category } };
  const previous = await tx.preferenceMemory.findUnique({ where });
  // Monotonic update time also guards undo against another edit in the same millisecond.
  const now = new Date(
    Math.max(Date.now(), (previous?.updatedAt.getTime() ?? 0) + 1),
  );
  const data = {
    value,
    source,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 180 * 86400000),
  };
  const memory = await tx.preferenceMemory.upsert({
    where,
    create: { ownerId, category, ...data },
    update: data,
  });
  const undo = await tx.memoryUndo.create({
    data: {
      ownerId,
      category,
      memoryId: memory.id,
      savedAt: memory.updatedAt,
      previous: previous ? JSON.stringify(previous) : null,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  return undo.id;
}
