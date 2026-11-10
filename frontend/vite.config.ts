import { defineConfig } from "vite";

const api = "http://127.0.0.1:8020";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": api, "/images": api },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // big libraries in their own files: they change rarely, so the browser keeps them cached
      output: { manualChunks: { three: ["three"], mediapipe: ["@mediapipe/tasks-vision"] } },
    },
  },
});
