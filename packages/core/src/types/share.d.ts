import { z } from "zod";
export declare const ShareRecordSchema: z.ZodObject<{
    name: z.ZodString;
    version: z.ZodString;
    targetType: z.ZodEnum<["gist", "repo", "local"]>;
    targetUrl: z.ZodString;
    gistId: z.ZodOptional<z.ZodString>;
    repoFullName: z.ZodOptional<z.ZodString>;
    lastSharedAt: z.ZodString;
    fingerprints: z.ZodObject<{
        mcpServers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        skills: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        mcpServers: Record<string, string>;
        skills: Record<string, string>;
    }, {
        mcpServers?: Record<string, string> | undefined;
        skills?: Record<string, string> | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    name: string;
    version: string;
    targetType: "gist" | "repo" | "local";
    targetUrl: string;
    lastSharedAt: string;
    fingerprints: {
        mcpServers: Record<string, string>;
        skills: Record<string, string>;
    };
    gistId?: string | undefined;
    repoFullName?: string | undefined;
}, {
    name: string;
    version: string;
    targetType: "gist" | "repo" | "local";
    targetUrl: string;
    lastSharedAt: string;
    fingerprints: {
        mcpServers?: Record<string, string> | undefined;
        skills?: Record<string, string> | undefined;
    };
    gistId?: string | undefined;
    repoFullName?: string | undefined;
}>;
export type ShareRecord = z.infer<typeof ShareRecordSchema>;
export declare const ShareHistorySchema: z.ZodObject<{
    shares: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
        targetType: z.ZodEnum<["gist", "repo", "local"]>;
        targetUrl: z.ZodString;
        gistId: z.ZodOptional<z.ZodString>;
        repoFullName: z.ZodOptional<z.ZodString>;
        lastSharedAt: z.ZodString;
        fingerprints: z.ZodObject<{
            mcpServers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
            skills: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            mcpServers: Record<string, string>;
            skills: Record<string, string>;
        }, {
            mcpServers?: Record<string, string> | undefined;
            skills?: Record<string, string> | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        version: string;
        targetType: "gist" | "repo" | "local";
        targetUrl: string;
        lastSharedAt: string;
        fingerprints: {
            mcpServers: Record<string, string>;
            skills: Record<string, string>;
        };
        gistId?: string | undefined;
        repoFullName?: string | undefined;
    }, {
        name: string;
        version: string;
        targetType: "gist" | "repo" | "local";
        targetUrl: string;
        lastSharedAt: string;
        fingerprints: {
            mcpServers?: Record<string, string> | undefined;
            skills?: Record<string, string> | undefined;
        };
        gistId?: string | undefined;
        repoFullName?: string | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    shares: {
        name: string;
        version: string;
        targetType: "gist" | "repo" | "local";
        targetUrl: string;
        lastSharedAt: string;
        fingerprints: {
            mcpServers: Record<string, string>;
            skills: Record<string, string>;
        };
        gistId?: string | undefined;
        repoFullName?: string | undefined;
    }[];
}, {
    shares?: {
        name: string;
        version: string;
        targetType: "gist" | "repo" | "local";
        targetUrl: string;
        lastSharedAt: string;
        fingerprints: {
            mcpServers?: Record<string, string> | undefined;
            skills?: Record<string, string> | undefined;
        };
        gistId?: string | undefined;
        repoFullName?: string | undefined;
    }[] | undefined;
}>;
export type ShareHistory = z.infer<typeof ShareHistorySchema>;
export interface ShareCommandOptions {
    provider?: "gist" | "repo" | "local" | string;
    repo?: string;
    branch?: string;
    output?: string;
    name?: string;
    description?: string;
    servers?: string[];
    skills?: string[];
    plugins?: string[];
    agents?: string[];
    isPublic?: boolean;
    public?: boolean;
    settings?: boolean;
    json?: boolean;
    yes?: boolean;
    secretKeys?: string[];
    secretValues?: string[];
    excludeSecretKeys?: string[];
}
