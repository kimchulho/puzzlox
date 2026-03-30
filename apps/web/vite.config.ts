import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, loadEnv } from "vite";

const webRoot = path.resolve(__dirname);
const repoRoot = path.resolve(__dirname, "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");

  return {
    root: webRoot,
    envDir: repoRoot,
    plugins: [react(), tailwindcss()],
    define: {
      "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        "@": path.join(webRoot, "src"),
        "@contracts": path.join(repoRoot, "packages/contracts"),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== "true",
    },
    build: {
      outDir: path.join(webRoot, "dist"),
      emptyOutDir: true,
    },
  };
});
