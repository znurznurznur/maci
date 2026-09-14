import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), tailwindcss(), nodePolyfills()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
      // Ensure workspace packages can resolve the polyfills shim even though
      // they don't depend on vite-plugin-node-polyfills directly.
      "vite-plugin-node-polyfills/shims/buffer": resolve(
        __dirname,
        "node_modules/vite-plugin-node-polyfills/shims/buffer",
      ),
      "vite-plugin-node-polyfills/shims/process": resolve(
        __dirname,
        "node_modules/vite-plugin-node-polyfills/shims/process",
      ),
      // @extended-maci/contracts/typechain-types is used by the SDK browser bundle.
      // Redirect to a local shim that provides the factories actually used at runtime.
      "@extended-maci/contracts/typechain-types": resolve(__dirname, "src/poll-factory-shim.ts"),
      // @extended-maci/contracts pulls in hardhat + native .node binaries.
      // Redirect to a browser-safe shim that only exports ABI factories + enums.
      "@extended-maci/contracts": resolve(__dirname, "src/maci-contracts-browser-shim.js"),
      // Dynamic require("hardhat") inside @extended-maci/contracts/ts/utils.js
      // would crash the browser. Redirect to an empty stub.
      hardhat: resolve(__dirname, "src/hardhat-stub.js"),
    },
  },
  optimizeDeps: {
    // @extended-maci/sdk's bare entry point (e.g. generateEmptyBallotRoots, used by
    // useCreateCommunity.ts) is CJS and wasn't being pre-bundled — only the /browser subpath
    // was, so the browser received the raw CommonJS file directly and failed to parse it as
    // ESM ("does not provide an export named ..."), crashing every page that imports it.
    include: ["@extended-maci/domainobjs", "@extended-maci/crypto", "@extended-maci/sdk", "@extended-maci/sdk/browser"],
    exclude: ["hardhat", "@nomicfoundation/solidity-analyzer"],
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/node_modules/, /packages\/.+\/build\//],
    },
    rollupOptions: {
      external: ["hardhat", "@nomicfoundation/solidity-analyzer"],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
