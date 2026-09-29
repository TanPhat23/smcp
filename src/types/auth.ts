import { z } from "zod";

export const ProviderAuthInfoSchema = z.object({
  username: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  endpoint: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type ProviderAuthInfo = z.infer<typeof ProviderAuthInfoSchema>;

export const AuthConfigSchema = z
  .object({
    githubToken: z.string().optional(),
    githubUser: z.string().optional(),
    tokens: z.record(z.string(), z.string()).default({}),
    providers: z.record(z.string(), ProviderAuthInfoSchema).default({})
  })
  .passthrough();

export type AuthConfig = z.input<typeof AuthConfigSchema>;
