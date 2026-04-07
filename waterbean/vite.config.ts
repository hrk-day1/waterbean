import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const waterbeanDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, waterbeanDir, "");
  const fromWaterbean = Number(env.WATERBEAN_PORT);
  const legacyPort = Number(env.PORT);
  const port =
    Number.isFinite(fromWaterbean) && fromWaterbean > 0
      ? fromWaterbean
      : Number.isFinite(legacyPort) && legacyPort > 0
        ? legacyPort
        : 8080;
  const apiPortParsed = Number(env.API_PORT);
  const apiPort =
    Number.isFinite(apiPortParsed) && apiPortParsed > 0 ? apiPortParsed : 4000;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port,
      proxy: {
        "/api": {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(waterbeanDir, "./src"),
      },
    },
  };
});
