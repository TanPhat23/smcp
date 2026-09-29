export interface LoadUserExtensionsOptions {
    cwd?: string;
    smcpDir?: string;
    disabled?: boolean;
    json?: boolean;
}
export declare function loadUserExtensions(options?: LoadUserExtensionsOptions): Promise<string[]>;
