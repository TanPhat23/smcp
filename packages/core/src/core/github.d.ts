import { type AxiosAdapter, type AxiosInstance } from "axios";
import { type Manifest } from "../types/index.ts";
import { HttpClient, createHttpClient, clearHttpClientCache, getOrCreateAxiosInstance } from "./http.ts";
export { HttpClient, createHttpClient, clearHttpClientCache, getOrCreateAxiosInstance };
export declare const DEFAULT_TIMEOUT_MS = 15000;
export declare function clearGitHubClientCache(): void;
export declare function setDefaultAxiosAdapter(adapter: AxiosAdapter | undefined): void;
export interface GitHubGistFile {
    content: string;
    filename?: string;
}
export interface CreateGistPayload {
    description: string;
    public: boolean;
    files: Record<string, {
        content: string;
    }>;
}
export interface GistResponseFile {
    filename?: string;
    type?: string;
    language?: string;
    raw_url?: string;
    size?: number;
    truncated?: boolean;
    content: string;
}
export interface GistResponse {
    id: string;
    html_url: string;
    description?: string;
    files: Record<string, GistResponseFile>;
    [key: string]: unknown;
}
export interface GitHubClientOptions {
    timeoutMs?: number;
    axiosInstance?: AxiosInstance;
    adapter?: AxiosAdapter;
    baseURL?: string;
}
export declare function createGitHubAxios(token?: string, options?: GitHubClientOptions | number): AxiosInstance;
export declare function formatApiError(errOrRes: unknown, defaultMsg: string): Promise<string>;
export declare function parseGistId(gistIdOrUrl: string): string;
export interface GitHubRepoRef {
    owner: string;
    repo: string;
    ref?: string;
    subpath?: string;
}
export declare function parseGitHubRepo(input: string): GitHubRepoRef | null;
export declare function isRepoSource(input: string): boolean;
export declare function generatePackReadme(manifest: Manifest, repoFullName?: string): string;
export interface RepoPackResult {
    manifest: Manifest;
    rawFiles: Record<string, string>;
    repoFullName: string;
    ref: string;
    htmlUrl: string;
}
export declare class GitHubClient {
    #private;
    static parseRepo(input: string): GitHubRepoRef | null;
    static isRepoSource(input: string): boolean;
    constructor(token?: string, options?: GitHubClientOptions | number);
    get client(): AxiosInstance;
    verifyUser(): Promise<{
        login: string;
        name: string;
        scopes?: string[];
        hasRepoScope?: boolean;
        hasGistScope?: boolean;
        [key: string]: unknown;
    }>;
    createGist(payload: CreateGistPayload): Promise<{
        id: string;
        html_url: string;
        [key: string]: unknown;
    }>;
    updateGist(gistId: string, payload: Partial<CreateGistPayload>): Promise<{
        id: string;
        html_url: string;
        [key: string]: unknown;
    }>;
    getRepository(owner: string, repo: string): Promise<{
        id: number;
        name: string;
        full_name: string;
        html_url: string;
        default_branch: string;
    } | null>;
    createRepository(payload: {
        name: string;
        description?: string;
        private?: boolean;
        org?: string;
        auto_init?: boolean;
    }): Promise<{
        id: number;
        name: string;
        full_name: string;
        html_url: string;
        default_branch: string;
    }>;
    commitFilesToRepo(params: {
        owner: string;
        repo: string;
        branch?: string;
        message: string;
        files: Record<string, string>;
        isPublic?: boolean;
        description?: string;
    }): Promise<{
        commitSha: string;
        html_url: string;
        branch: string;
    }>;
    static fetchRepoFileContent(client: AxiosInstance, owner: string, repo: string, ref: string, filePath: string, blobSha?: string): Promise<string>;
    static fetchRepoPack(source: string, token?: string, options?: GitHubClientOptions | number): Promise<RepoPackResult>;
    static fetchGist(gistIdOrUrl: string, token?: string, options?: GitHubClientOptions | number): Promise<GistResponse>;
}
