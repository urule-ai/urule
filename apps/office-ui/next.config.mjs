import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Tell Next to trace deps from the workspace root, not just apps/office-ui.
  // Without this, the standalone bundle is emitted at .next/standalone/server.js
  // and ships with no node_modules/ — start-up then resolves Next internals
  // against the workspace's hoisted node_modules and crashes on the first
  // missing internal file. With it set, the standalone tree is rooted at
  // .next/standalone/apps/office-ui/ and includes a pruned node_modules/
  // alongside it (matches what apps/office-ui/Dockerfile expects).
  outputFileTracingRoot: join(__dirname, "../../"),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
