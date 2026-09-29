import { z } from "zod";
export declare const RequiredEnvSchema: z.ZodObject<{
    key: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    isSecret: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    key: string;
    isSecret: boolean;
    description?: string | undefined;
}, {
    key: string;
    description?: string | undefined;
    isSecret?: boolean | undefined;
}>;
export type RequiredEnv = z.infer<typeof RequiredEnvSchema>;
