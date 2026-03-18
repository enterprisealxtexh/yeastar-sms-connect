import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: '/',
  server: {
    host: "localhost",
    port: 8081,
    hmr: {
      overlay: false,
      host: "localhost",
      port: 8081,
    },
  },
  preview: {
    host: "localhost",
    port: 4173,
    allowedHosts: ["localhost", "127.0.0.1"],
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Code splitting strategy for better chunk optimization
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate major dependencies into their own chunks
          'react-core': ['react', 'react-dom', 'react-router-dom'],
          'react-query': ['@tanstack/react-query'],
          'ui-components': ['@radix-ui/react-dialog', '@radix-ui/react-tabs', '@radix-ui/react-dropdown-menu'],
          'utils': ['sonner', 'date-fns', 'zod'],
        },
      },
    },
    // Increase optimization for production
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: mode === 'production',
      },
    },
    // Optimize chunk size
    chunkSizeWarningLimit: 1000,
    cssCodeSplit: true,
    sourcemap: mode !== 'production',
  },
  // Optimize dependencies pre-bundling
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@tanstack/react-query',
      '@radix-ui/react-dialog',
      '@radix-ui/react-tabs',
      '@radix-ui/react-dropdown-menu',
      'sonner',
      'date-fns',
      'zod',
      'lucide-react',
    ],
  },
}));
