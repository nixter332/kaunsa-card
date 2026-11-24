import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests run in Node by default. UI tests opt into a browser-like DOM with `// @vitest-environment jsdom` at the top.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
