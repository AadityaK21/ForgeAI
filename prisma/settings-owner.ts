import { PrismaClient } from "@prisma/client";
import { saveEnvironment } from "../src/lib/server-settings";
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw Error("Supply the email of an existing ForgeAI account.");
  const db = new PrismaClient();
  try {
    const owner = await db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!owner) throw Error("No builder account has that email.");
    await saveEnvironment({ FORGE_SETTINGS_ADMIN_ID: owner.id });
    console.log(
      "Local settings owner saved. Restart the development server to apply.",
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
