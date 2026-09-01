import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;
const LOCAL_ENV_KEYS = [
  "WINDING_SITE_ACCESS_PASSWORD",
  "AZURE_CONTENT_UNDERSTANDING_ENDPOINT",
  "AZURE_CONTENT_UNDERSTANDING_ANALYZER_ID",
  "AZURE_CONTENT_UNDERSTANDING_API_VERSION",
  "CONTENT_UNDERSTANDING_KEY",
];

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

function localBindingConfig(vars: Record<string, string>) {
  return {
    main: "./worker/index.ts",
    compatibility_flags: ["nodejs_compat"],
    vars,
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: "site-creator-d1",
            database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          },
        ]
      : [],
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: "site-creator-r2",
          },
        ]
      : [],
  };
}

export default defineConfig(async ({ command, mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const fileEnv = command === "serve" ? loadEnv(mode, process.cwd(), "") : {};
  const localVars = command === "serve"
    ? Object.fromEntries(
        LOCAL_ENV_KEYS
          .map((key) => [key, process.env[key] || fileEnv[key]] as const)
          .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
      )
    : {};

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig(localVars),
      }),
    ],
  };
});
