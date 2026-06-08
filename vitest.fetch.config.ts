import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "/@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/services/__tests__/image-fetch.spec.ts"],
    setupFiles: ["./src/tests/setup.ts"],
  },
});
