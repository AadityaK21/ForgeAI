import { PrismaClient } from "@prisma/client";

const email = process.argv[2]?.trim().toLowerCase();
if (!email)
  throw Error("Supply the account email that owns the pre-account workspace.");
const db = new PrismaClient();
try {
  const user = await db.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  const result = await db.project.updateMany({
    where: { ownerId: null },
    data: { ownerId: user.id },
  });
  console.log("Assigned " + result.count + " previously unowned projects.");
} finally {
  await db.$disconnect();
}
