import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Tell Next to trace deps from the workspace root, not just apps/office-ui.
  // Without this, the standalone bundle ships with no node_modules/ alongside
  // server.js — start-up then resolves Next internals against the workspace's
  // hoisted node_modules and crashes on the first missing internal file
  // (./node-polyfill-crypto in this repo). With it set, the standalone tree
  // includes a pruned node_modules/ that has everything the runtime needs.
  // In Next 14.x this option lives under `experimental` (promoted to
  // top-level in Next 15).
  experimental: {
    outputFileTracingRoot: join(__dirname, "../../"),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
