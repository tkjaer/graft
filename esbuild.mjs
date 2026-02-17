import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  sourcemap: true,
  minify: !watch,
};

// Extension (Node)
const extOpts = {
  ...shared,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  external: ["vscode"],
};

// Webview (Browser)
const webOpts = {
  ...shared,
  entryPoints: ["src/webview/main.ts"],
  outfile: "dist/webview.js",
  platform: "browser",
  format: "iife",
};

if (watch) {
  const [ext, web] = await Promise.all([
    esbuild.context(extOpts),
    esbuild.context(webOpts),
  ]);
  await Promise.all([ext.watch(), web.watch()]);
  console.log("[graft] watching…");
} else {
  await Promise.all([esbuild.build(extOpts), esbuild.build(webOpts)]);
  console.log("[graft] build complete");
}
