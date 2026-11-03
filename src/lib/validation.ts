import { z } from "zod";
export const newProject = z
  .object({ title: z.string().trim().min(2).max(80) })
  .strict();
export const brief = z
  .object({
    projectId: z.string().min(1).max(100),
    revision: z.number().int().nonnegative(),
    prompt: z.string().trim().min(8).max(6000),
    engine: z.enum(["auto", "instant", "local", "cloud"]).default("auto"),
    mode: z.enum(["plan", "build"]).default("build"),
  })
  .strict();
