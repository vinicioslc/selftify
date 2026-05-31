import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "/@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/youtubei": {
        target: "https://www.youtube.com",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "chrome120",
    minify: "esbuild",
    sourcemap: true,
  },
});
