import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Production build: keep the shipped frontend tiny and fast to parse.
  build: {
    // Modern but widely supported target — lets esbuild drop older-shim code.
    target: "es2020",
    minify: "esbuild",
    cssMinify: true,
    // No sourcemaps in the released bundle.
    sourcemap: false,
    // Small files compress better inside the NSIS installer.
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        // Stable, short filenames; group the heavy 3D lib so it caches well.
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
      },
    },
  },
}));
