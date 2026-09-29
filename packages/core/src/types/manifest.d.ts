import { z } from "zod";
import { type McpServerConfig } from "./mcp.ts";
import { type SkillEntry } from "./skill.ts";
import { type PluginEntry } from "./plugin.ts";
import { type RequiredEnv } from "./env.ts";
export declare const ManifestSchema: z.ZodObject<{
    $schema: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    version: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    author: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodOptional<z.ZodString>;
    mcpServers: z.ZodDefault<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        command: z.ZodOptional<z.ZodString>;
        args: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        url: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        command: z.ZodOptional<z.ZodString>;
        args: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        url: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        command: z.ZodOptional<z.ZodString>;
        args: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        url: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>>>>;
    skills: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
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
    }>, "many">>>;
    plugins: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodEffects<z.ZodString, string, string>, z.ZodObject<{
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
    }>]>, "many">>>;
    requiredEnv: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
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
    }>, "many">>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    $schema: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    version: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    author: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodOptional<z.ZodString>;
    mcpServers: z.ZodDefault<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        command: z.ZodOptional<z.ZodString>;
        args: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        url: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        command: z.ZodOptional<z.ZodString>;
        args: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        url: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        command: z.ZodOptional<z.ZodString>;
        args: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        url: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>>>>;
    skills: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
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
    }>, "many">>>;
    plugins: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodEffects<z.ZodString, string, string>, z.ZodObject<{
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
    }>]>, "many">>>;
    requiredEnv: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
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
    }>, "many">>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    $schema: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    version: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    author: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodOptional<z.ZodString>;
    mcpServers: z.ZodDefault<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        command: z.ZodOptional<z.ZodString>;
        args: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        url: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        command: z.ZodOptional<z.ZodString>;
        args: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        url: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        command: z.ZodOptional<z.ZodString>;
        args: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        url: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>>>>;
    skills: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
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
    }>, "many">>>;
    plugins: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodEffects<z.ZodString, string, string>, z.ZodObject<{
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
    }>]>, "many">>>;
    requiredEnv: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
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
    }>, "many">>>;
}, z.ZodTypeAny, "passthrough">>;
export interface Manifest {
    $schema?: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    createdAt?: string;
    updatedAt?: string;
    mcpServers?: Record<string, McpServerConfig>;
    skills?: SkillEntry[];
    plugins?: PluginEntry[];
    requiredEnv?: RequiredEnv[];
    [key: string]: unknown;
}
