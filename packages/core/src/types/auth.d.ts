import { z } from "zod";
export declare const ProviderAuthInfoSchema: z.ZodObject<{
    username: z.ZodOptional<z.ZodString>;
    scopes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    endpoint: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    username?: string | undefined;
    scopes?: string[] | undefined;
    endpoint?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    username?: string | undefined;
    scopes?: string[] | undefined;
    endpoint?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}>;
export type ProviderAuthInfo = z.infer<typeof ProviderAuthInfoSchema>;
export declare const AuthConfigSchema: z.ZodObject<{
    githubToken: z.ZodOptional<z.ZodString>;
    githubUser: z.ZodOptional<z.ZodString>;
    tokens: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    providers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        username: z.ZodOptional<z.ZodString>;
        scopes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        endpoint: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        username?: string | undefined;
        scopes?: string[] | undefined;
        endpoint?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }, {
        username?: string | undefined;
        scopes?: string[] | undefined;
        endpoint?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }>>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    githubToken: z.ZodOptional<z.ZodString>;
    githubUser: z.ZodOptional<z.ZodString>;
    tokens: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    providers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        username: z.ZodOptional<z.ZodString>;
        scopes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        endpoint: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        username?: string | undefined;
        scopes?: string[] | undefined;
        endpoint?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }, {
        username?: string | undefined;
        scopes?: string[] | undefined;
        endpoint?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }>>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    githubToken: z.ZodOptional<z.ZodString>;
    githubUser: z.ZodOptional<z.ZodString>;
    tokens: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    providers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        username: z.ZodOptional<z.ZodString>;
        scopes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        endpoint: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        username?: string | undefined;
        scopes?: string[] | undefined;
        endpoint?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }, {
        username?: string | undefined;
        scopes?: string[] | undefined;
        endpoint?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }>>>;
}, z.ZodTypeAny, "passthrough">>;
export type AuthConfig = z.input<typeof AuthConfigSchema>;
