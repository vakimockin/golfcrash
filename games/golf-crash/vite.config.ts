import { sveltekit } from "@sveltejs/kit/vite";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { defineConfig } from "vite";
import type { Plugin, ResolvedConfig } from "vite";

const MAX_BUILD_SIZE_BYTES = 50 * 1024 * 1024;
const red = (value: string): string => `\x1b[31m${value}\x1b[0m`;
const dim = (value: string): string => `\x1b[2m${value}\x1b[0m`;
const cyan = (value: string): string => `\x1b[36m${value}\x1b[0m`;
const yellow = (value: string): string => `\x1b[33m${value}\x1b[0m`;
const blue = (value: string): string => `\x1b[34m${value}\x1b[0m`;

type BrowserLogPayload = {
  level: "log" | "info" | "warn" | "error" | "debug";
  args: unknown[];
};

const formatBrowserArg = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (
    typeof value === "object" &&
    value !== null &&
    "__err" in value &&
    (value as { __err?: boolean }).__err
  ) {
    const err = value as { message?: string; stack?: string };
    return `${err.message ?? ""}${err.stack ? "\n" + err.stack : ""}`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const browserLoggerPlugin = (): Plugin => ({
  name: "golf-crash-browser-logger",
  apply: "serve",
  configureServer(server) {
    server.ws.on("golf-crash:log", (data: BrowserLogPayload) => {
      const { level, args } = data ?? { level: "log", args: [] };
      const tag =
        level === "error"
          ? red("ERR ")
          : level === "warn"
            ? yellow("WARN")
            : level === "info"
              ? blue("INFO")
              : level === "debug"
                ? dim("DBG ")
                : cyan("LOG ");
      const text = (args ?? []).map(formatBrowserArg).join(" ");
      // eslint-disable-next-line no-console
      console.log(`${dim("[browser]")} ${tag} ${text}`);
    });
  },
});

const directorySize = async (path: string): Promise<number> => {
  const entry = await stat(path);
  if (!entry.isDirectory()) return entry.size;

  const children = await readdir(path);
  const sizes = await Promise.all(children.map((child) => directorySize(resolve(path, child))));
  return sizes.reduce((sum, size) => sum + size, 0);
};

const buildSizeWarningPlugin = (): Plugin => {
  let root = process.cwd();
  let outDir = "dist";
  let reported = false;

  return {
    name: "golf-crash-build-size-warning",
    configResolved(config: ResolvedConfig) {
      root = config.root;
      outDir = config.build.outDir;
    },
    async closeBundle() {
      if (reported) return;

      const configuredOutDir = isAbsolute(outDir) ? outDir : resolve(root, outDir);
      const candidates = [resolve(root, "build"), configuredOutDir, resolve(root, "dist")];
      const outputDir = candidates.find((candidate) => existsSync(candidate));
      if (!outputDir) return;

      reported = true;
      const size = await directorySize(outputDir);
      const sizeMb = size / 1024 / 1024;
      if (size > MAX_BUILD_SIZE_BYTES) {
        console.warn(
          red(
            `[build-size] ${outputDir} is ${sizeMb.toFixed(2)} MB, which exceeds the 50 MB CDN budget.`,
          ),
        );
      }
    },
  };
};

export default defineConfig({
  plugins: [sveltekit(), browserLoggerPlugin(), buildSizeWarningPlugin()],
  build: {
    rollupOptions: {
      output: {
        compact: true,
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
