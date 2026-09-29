export interface InstallCommandOptions {
    agents?: string[];
    force?: boolean;
    env?: Record<string, string>;
    pluginDir?: string;
    json?: boolean;
    yes?: boolean;
}
