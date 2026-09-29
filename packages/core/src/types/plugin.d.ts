import { z } from "zod";
export declare const PluginObjectEntrySchema: z.ZodObject<{
    name: z.ZodEffects<z.ZodString, string, string>;
    targetAgent: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    path: z.ZodOptional<z.ZodString>;
    files: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    path?: string | undefined;
    description?: string | undefined;
    files?: Record<string, string> | undefined;
    targetAgent?: string | undefined;
}, {
    name: string;
    path?: string | undefined;
    description?: string | undefined;
    files?: Record<string, string> | undefined;
    targetAgent?: string | undefined;
}>;
export declare const PluginEntrySchema: z.ZodUnion<[z.ZodEffects<z.ZodString, string, string>, z.ZodObject<{
    name: z.ZodEffects<z.ZodString, string, string>;
    targetAgent: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    path: z.ZodOptional<z.ZodString>;
    files: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    path?: string | undefined;
    description?: string | undefined;
    files?: Record<string, string> | undefined;
    targetAgent?: string | undefined;
}, {
    name: string;
    path?: string | undefined;
    description?: string | undefined;
    files?: Record<string, string> | undefined;
    targetAgent?: string | undefined;
}>]>;
export type PluginObjectEntry = z.infer<typeof PluginObjectEntrySchema>;
export type PluginEntry = z.infer<typeof PluginEntrySchema>;
