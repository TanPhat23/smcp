import { z } from "zod";
export declare const SkillEntrySchema: z.ZodObject<{
    name: z.ZodString;
    path: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    contentHash: z.ZodOptional<z.ZodString>;
    files: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    path: string;
    name: string;
    description?: string | undefined;
    contentHash?: string | undefined;
    files?: Record<string, string> | undefined;
}, {
    path: string;
    name: string;
    description?: string | undefined;
    contentHash?: string | undefined;
    files?: Record<string, string> | undefined;
}>;
export type SkillEntry = z.infer<typeof SkillEntrySchema>;
