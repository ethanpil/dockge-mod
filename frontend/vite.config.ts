import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import viteCompression from "vite-plugin-compression";
import "vue";

const viteCompressionFilter = /\.(js|mjs|json|css|html|svg)$/i;

// https://vitejs.dev/config/
export default defineConfig({
    server: {
        port: 5000,
    },
    define: {
        "FRONTEND_VERSION": JSON.stringify(process.env.npm_package_version),
    },
    root: "./frontend",
    build: {
        outDir: "../frontend-dist",
    },
    plugins: [
        vue(),
        viteCompression({
            algorithm: "gzip",
            filter: viteCompressionFilter,
        }),
        viteCompression({
            algorithm: "brotliCompress",
            filter: viteCompressionFilter,
        }),
    ],
});
