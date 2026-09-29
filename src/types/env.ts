import { z } from "zod";

export const RequiredEnvSchema = z.object({
  key: z.string(),
  description: z.string().optional(),
  isSecret: z.boolean().default(true)
});

export type RequiredEnv = z.infer<typeof RequiredEnvSchema>;
