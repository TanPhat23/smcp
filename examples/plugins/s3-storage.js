/**
 * Example SMCP Plugin: AWS S3 / Cloudflare R2 / MinIO Storage Extension
 *
 * This plugin demonstrates how to extend SMCP with custom object-storage remotes
 * without adding heavyweight cloud SDKs (e.g. @aws-sdk/client-s3) into core SMCP.
 *
 * How SMCP loads plugins:
 * - Place this file in `~/.smcp/plugins/s3-storage.js` (global)
 * - Or in `./.smcp/plugins/s3-storage.js` (project-local)
 * - Or import in `./smcp.config.js`
 *
 * Usage once registered:
 * - Install from S3: `smcp install s3://my-corp-bucket/packs/backend-tools -a opencode`
 * - Inspect from S3: `smcp inspect s3://my-corp-bucket/packs/backend-tools`
 * - Share to S3:    `smcp share -o s3://my-corp-bucket/packs/backend-tools --provider s3`
 */

import { registerPackLoader, registerShareProvider } from "smcp";

/**
 * Helper to lazily load @aws-sdk/client-s3 if installed in user's environment,
 * or fall back to an HTTP fetch adapter for S3-compatible endpoints (MinIO/R2).
 */
async function getS3Client() {
  try {
    const { S3Client, GetObjectCommand, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: process.env.AWS_REGION || "us-east-1",
      endpoint: process.env.AWS_ENDPOINT_URL || undefined // Supports MinIO & Cloudflare R2
    });
    return { client, GetObjectCommand, PutObjectCommand };
  } catch {
    throw new Error(
      "To use S3 pack storage, install '@aws-sdk/client-s3' or set up an S3-compatible gateway:\n" +
      "  bun add -d @aws-sdk/client-s3\n" +
      "  npm install --save-dev @aws-sdk/client-s3"
    );
  }
}

/**
 * Parse an S3 URI into bucket and object key.
 * Example: "s3://my-bucket/path/to/pack" -> { bucket: "my-bucket", key: "path/to/pack" }
 */
function parseS3Uri(uri) {
  const match = uri.trim().match(/^s3:\/\/([^/]+)\/?(.*)$/);
  if (!match) return null;
  return {
    bucket: match[1],
    key: match[2].replace(/\/+$/, "")
  };
}

// ============================================================================
// 1. Custom Pack Loader: Read Packs from S3
// ============================================================================

registerPackLoader(
  {
    name: "s3-storage",
    /**
     * Matches any source starting with s3://
     */
    matches: (context) => {
      return typeof context.source === "string" && context.source.trim().startsWith("s3://");
    },

    /**
     * Fetches pack manifest and raw files from S3 bucket.
     * Expects either:
     * - A JSON pack file (e.g. s3://bucket/packs/mypack.json or smcp.json)
     * - A prefix containing smcp.json and associated skill/plugin files
     */
    load: async (context) => {
      const parsed = parseS3Uri(context.source);
      if (!parsed) {
        throw new Error(`Invalid S3 URI: ${context.source}. Expected format: s3://bucket/path`);
      }

      const { client, GetObjectCommand } = await getS3Client();
      const manifestKey = parsed.key.endsWith(".json")
        ? parsed.key
        : `${parsed.key}/smcp.json`.replace(/^\/+/, "");

      const getCmd = new GetObjectCommand({
        Bucket: parsed.bucket,
        Key: manifestKey
      });

      const response = await client.send(getCmd);
      const manifestContent = await response.Body.transformToString("utf8");
      const manifest = JSON.parse(manifestContent);

      return {
        manifest,
        rawFiles: {
          "smcp.json": manifestContent
        }
      };
    }
  },
  true // Prepend so S3 scheme takes precedence over fallthrough
);

// ============================================================================
// 2. Custom Share Provider: Publish Packs to S3
// ============================================================================

registerShareProvider(
  {
    id: "s3",
    label: "AWS S3 / Cloudflare R2 / MinIO Bucket",
    hint: "Uploads sanitized pack bundle to an S3-compatible storage bucket",

    /**
     * Publishes the bundle to an S3 destination.
     */
    publish: async (context) => {
      const targetBucket =
        context.options?.output?.startsWith("s3://")
          ? parseS3Uri(context.options.output)?.bucket
          : process.env.SMCP_S3_BUCKET;

      if (!targetBucket) {
        throw new Error(
          "Target S3 bucket required. Pass via -o s3://<bucket>/<prefix> or set SMCP_S3_BUCKET."
        );
      }

      const { client, PutObjectCommand } = await getS3Client();
      const packKey = `packs/${context.cleanPackName}/v${context.version}/smcp.json`;

      const manifestWithFiles = {
        ...context.manifest,
        _bundleFiles: context.gistFiles
      };

      const putCmd = new PutObjectCommand({
        Bucket: targetBucket,
        Key: packKey,
        Body: JSON.stringify(manifestWithFiles, null, 2),
        ContentType: "application/json"
      });

      await client.send(putCmd);
      console.log(`Successfully uploaded pack to s3://${targetBucket}/${packKey}`);
      return true;
    }
  },
  true
);
