import { z } from "zod";

export const AuthConfigSchema = z.object({
  githubToken: z.string().optional(),
  githubUser: z.string().optional()
});

export type AuthConfig = z.infer<typeof AuthConfigSchema>;
