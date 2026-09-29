import { z } from "zod";
export declare const AgentProfileSchema: z.ZodObject<{
    name: z.ZodString;
    mcpConfig: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        paths: z.ZodArray<z.ZodString, "many">;
        key: z.ZodDefault<z.ZodString>;
        format: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        key: string;
        paths: string[];
        format?: string | undefined;
    }, {
        paths: string[];
        key?: string | undefined;
        format?: string | undefined;
    }>>>;
    skills: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        paths: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        paths: string[];
    }, {
        paths: string[];
    }>>>;
    plugins: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        paths: z.ZodArray<z.ZodString, "many">;
        key: z.ZodDefault<z.ZodString>;
        format: z.ZodDefault<z.ZodEnum<["array", "map"]>>;
        dirPaths: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        key: string;
        paths: string[];
        format: "map" | "array";
        dirPaths?: string[] | undefined;
    }, {
        paths: string[];
        key?: string | undefined;
        format?: "map" | "array" | undefined;
        dirPaths?: string[] | undefined;
    }>>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    skills?: {
        paths: string[];
    } | null | undefined;
    plugins?: {
        key: string;
        paths: string[];
        format: "map" | "array";
        dirPaths?: string[] | undefined;
    } | null | undefined;
    mcpConfig?: {
        key: string;
        paths: string[];
        format?: string | undefined;
    } | null | undefined;
}, {
    name: string;
    skills?: {
        paths: string[];
    } | null | undefined;
    plugins?: {
        paths: string[];
        key?: string | undefined;
        format?: "map" | "array" | undefined;
        dirPaths?: string[] | undefined;
    } | null | undefined;
    mcpConfig?: {
        paths: string[];
        key?: string | undefined;
        format?: string | undefined;
    } | null | undefined;
}>;
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
export declare const DetectedAgentSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    mcpConfigPath: z.ZodNullable<z.ZodString>;
    skillsDirPath: z.ZodNullable<z.ZodString>;
    pluginsConfigPath: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    pluginsDirPath: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    id: string;
    mcpConfigPath: string | null;
    skillsDirPath: string | null;
    pluginsConfigPath?: string | null | undefined;
    pluginsDirPath?: string | null | undefined;
}, {
    name: string;
    id: string;
    mcpConfigPath: string | null;
    skillsDirPath: string | null;
    pluginsConfigPath?: string | null | undefined;
    pluginsDirPath?: string | null | undefined;
}>;
export type DetectedAgent = z.infer<typeof DetectedAgentSchema>;
