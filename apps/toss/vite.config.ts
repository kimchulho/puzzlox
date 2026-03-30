import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, loadEnv } from "vite";

const tossRoot = path.resolve(__dirname);
const repoRoot = path.resolve(__dirname, "../..");
const webSrc = path.join(repoRoot, "apps/web/src");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const proxyTarget = (env.TOSS_DEV_API_TARGET || "http://127.0.0.1:3000").replace(/\/$/, "");

  return {
    root: tossRoot,
    envDir: repoRoot,
    plugins: [react(), tailwindcss()],
    define: {
      "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        "@web": webSrc,
        "@contracts": path.join(repoRoot, "packages/contracts"),
      },
    },
    server: {
      port: 5174,
      strictPort: false,
      proxy: {
        "/api": { target: proxyTarget, changeOrigin: true },
        "/socket.io": { target: proxyTarget, ws: true, changeOrigin: true },
      },
    },
    build: {
      outDir: path.join(tossRoot, "dist"),
      emptyOutDir: true,
    },
    optimizeDeps: {
      include: ["@apps-in-toss/web-framework"],
    },
  };
});
