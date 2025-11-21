// vite.config.ts
import path from "path";
import vue from "file:///app/web/node_modules/@vitejs/plugin-vue/dist/index.mjs";
import { defineConfig } from "file:///app/web/node_modules/vite/dist/node/index.js";
import svgLoader from "vite-svg-loader";
var __vite_injected_original_dirname = "/app/web";
var host = process.env.TAURI_DEV_HOST;
var vite_config_default = defineConfig({
  plugins: [vue(), svgLoader()],
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src"),
      "@server": path.resolve(__vite_injected_original_dirname, "../server/src")
    }
  },
  optimizeDeps: {
    include: ["@morev/vue-transitions"]
  },
  server: {
    port: parseInt(process.env.VITE_PORT || "5173")
    // host: host || false,
    // strictPort: true,
  }
  // envPrefix: ['VITE_', 'TAURI_ENV_*'],
  // build: {
  //   target:
  //     process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
  //   minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
  //   sourcemap: !!process.env.TAURI_ENV_DEBUG,
  // },
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvYXBwL3dlYlwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2FwcC93ZWIvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL2FwcC93ZWIvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgcGF0aCBmcm9tICdwYXRoJ1xuaW1wb3J0IHZ1ZSBmcm9tICdAdml0ZWpzL3BsdWdpbi12dWUnXG5pbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHN2Z0xvYWRlciBmcm9tICd2aXRlLXN2Zy1sb2FkZXInXG5cbmNvbnN0IGhvc3QgPSBwcm9jZXNzLmVudi5UQVVSSV9ERVZfSE9TVFxuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbdnVlKCksIHN2Z0xvYWRlcigpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYycpLFxuICAgICAgJ0BzZXJ2ZXInOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vc2VydmVyL3NyYycpLFxuICAgIH0sXG4gIH0sXG4gIG9wdGltaXplRGVwczoge1xuICAgIGluY2x1ZGU6IFsnQG1vcmV2L3Z1ZS10cmFuc2l0aW9ucyddLFxuICB9LFxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiBwYXJzZUludChwcm9jZXNzLmVudi5WSVRFX1BPUlQgfHwgJzUxNzMnKSxcbiAgICAvLyBob3N0OiBob3N0IHx8IGZhbHNlLFxuICAgIC8vIHN0cmljdFBvcnQ6IHRydWUsXG4gIH0sXG4gIC8vIGVudlByZWZpeDogWydWSVRFXycsICdUQVVSSV9FTlZfKiddLFxuICAvLyBidWlsZDoge1xuICAvLyAgIHRhcmdldDpcbiAgLy8gICAgIHByb2Nlc3MuZW52LlRBVVJJX0VOVl9QTEFURk9STSA9PT0gJ3dpbmRvd3MnID8gJ2Nocm9tZTEwNScgOiAnc2FmYXJpMTMnLFxuICAvLyAgIG1pbmlmeTogIXByb2Nlc3MuZW52LlRBVVJJX0VOVl9ERUJVRyA/ICdlc2J1aWxkJyA6IGZhbHNlLFxuICAvLyAgIHNvdXJjZW1hcDogISFwcm9jZXNzLmVudi5UQVVSSV9FTlZfREVCVUcsXG4gIC8vIH0sXG59KVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUEwTSxPQUFPLFVBQVU7QUFDM04sT0FBTyxTQUFTO0FBQ2hCLFNBQVMsb0JBQW9CO0FBQzdCLE9BQU8sZUFBZTtBQUh0QixJQUFNLG1DQUFtQztBQUt6QyxJQUFNLE9BQU8sUUFBUSxJQUFJO0FBRXpCLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxJQUFJLEdBQUcsVUFBVSxDQUFDO0FBQUEsRUFDNUIsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxLQUFLLFFBQVEsa0NBQVcsT0FBTztBQUFBLE1BQ3BDLFdBQVcsS0FBSyxRQUFRLGtDQUFXLGVBQWU7QUFBQSxJQUNwRDtBQUFBLEVBQ0Y7QUFBQSxFQUNBLGNBQWM7QUFBQSxJQUNaLFNBQVMsQ0FBQyx3QkFBd0I7QUFBQSxFQUNwQztBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTSxTQUFTLFFBQVEsSUFBSSxhQUFhLE1BQU07QUFBQTtBQUFBO0FBQUEsRUFHaEQ7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQVFGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
