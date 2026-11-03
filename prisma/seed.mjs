import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
try {
  await db.project.upsert({
    where: { id: "launch-notes" },
    update: {},
    create: {
      id: "launch-notes",
      title: "Founder launch notes",
      files: {
        create: [
          {
            path: "BRIEF.md",
            content:
              "# Launch notes\n\nBuild a private workspace for customer interviews. Record the problem, current workaround and next experiment. Group notes by hypothesis.\n",
          },
        ],
      },
    },
  });
} finally {
  await db.$disconnect();
}
