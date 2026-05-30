import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "/@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "./out/web"),
    emptyOutDir: true,
    target: "chrome120",
    minify: "esbuild",
    sourcemap: true,
  },
  root: "./",
});
