import { defineConfig } from "vite";
import pdfProxy from './vite-plugin-pdf-proxy.js'

export default defineConfig({
  plugins: [pdfProxy()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/data": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
