export interface InstallCommandOptions {
  agents?: string[];
  force?: boolean;
  env?: Record<string, string>;
  pluginDir?: string;
  runtime?: string;
  scope?: "global" | "project";
  project?: boolean;
  global?: boolean;
  nativeEnv?: boolean;
  json?: boolean;
  yes?: boolean;
}
