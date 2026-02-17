import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
  },
  define: {
    // Prevent process.env references from Octokit/Node compat
    "process.env.NODE_DEBUG": "undefined",
  },
});
