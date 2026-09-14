/* eslint-disable @typescript-eslint/no-var-requires */
// hardhat-toolbox bundles test-only plugins (hardhat-chai-matchers, gas-reporter, etc.) that
// need devDependencies (chai) not present in the production image (pnpm deploy --prod strips
// them) — this file is shared between local dev/test and the coordinator's runtime image
// (apps/coordinator/Dockerfile copies it in for ts-node/tsconfig resolution). proof.service.ts
// only ever uses hre.ethers (hardhat-ethers, already a real dependency), never anything else
// from the toolbox, so falling back to just that plugin in the stripped-down production case
// keeps local dev/test behavior (chai-matchers etc.) fully unchanged while fixing prod.
try {
  require("@nomicfoundation/hardhat-toolbox");
} catch {
  require("@nomicfoundation/hardhat-ethers");
}
const dotenv = require("dotenv");

const path = require("path");

dotenv.config();

const parentDir = __dirname.includes("build") ? ".." : "";
const TEST_MNEMONIC = "test test test test test test test test test test test junk";

module.exports = {
  defaultNetwork: "localhost",
  networks: {
    localhost: {
      url: process.env.COORDINATOR_RPC_URL || "http://localhost:8545",
      accounts: process.env.PRIVATE_KEY
        ? [process.env.PRIVATE_KEY]
        : {
            mnemonic: process.env.MNEMONIC || TEST_MNEMONIC,
            path: "m/44'/60'/0'/0",
            initialIndex: process.env.INITIAL_INDEX ? Number(process.env.INITIAL_INDEX) : 0,
            count: 20,
          },
    },
    hardhat: {
      loggingEnabled: false,
      mining: {
        auto: false,
        interval: 5000,
      },
    },
  },
  solidity: {
    version: "0.8.28",
  },
  paths: {
    sources: path.resolve(
      __dirname,
      parentDir,
      "./node_modules/@znurznurznur/extended-maci-sdk/node_modules/@znurznurznur/extended-maci-contracts/contracts",
    ),
    artifacts: path.resolve(
      __dirname,
      parentDir,
      "./node_modules/@znurznurznur/extended-maci-sdk/node_modules/@znurznurznur/extended-maci-contracts/artifacts",
    ),
  },
};
