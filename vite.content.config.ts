import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    target: "chrome116",
    emptyOutDir: false,
    lib: {
      entry: "src/content/index.ts",
      name: "LayrInspector",
      formats: ["iife"],
      fileName: () => "content.js",
    },
  },
});
