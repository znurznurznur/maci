import { ESupportedChains } from "@znurznurznur/extended-maci-sdk";
import {
  mainnet,
  sepolia,
  arbitrum,
  localhost,
  arbitrumSepolia,
  baseSepolia,
  lineaSepolia,
  scrollSepolia,
  scroll,
  base,
  linea,
  gnosis,
  polygon,
  optimism,
  optimismSepolia,
  hardhat,
  polygonAmoy,
  polygonZkEvm,
  polygonZkEvmCardona,
  zksyncSepoliaTestnet,
  zksync,
  gnosisChiado,
} from "viem/chains";

import { getBundlerClient, getPublicClient, getZeroDevBundlerRPCUrl } from "../accountAbstraction";
import { getRpcUrl } from "../chain";
import { ErrorCodes } from "../errors";
import { viemChain } from "../networks";

describe("common", () => {
  describe("getPublicClient", () => {
    test("should return a public client", async () => {
      const publicClient = await getPublicClient(ESupportedChains.Sepolia);
      expect(publicClient).toBeDefined();
    });

    test("should throw when given an unsupported network", async () => {
      await expect(() => getPublicClient("Unsupported" as ESupportedChains)).rejects.toThrow(
        ErrorCodes.UNSUPPORTED_NETWORK.toString(),
      );
    });
  });

  describe("getZeroDevBundlerRPCUrl", () => {
    test("should throw when the network is not supported", () => {
      expect(() => getZeroDevBundlerRPCUrl("Unsupported" as ESupportedChains)).toThrow(
        ErrorCodes.UNSUPPORTED_NETWORK.toString(),
      );
    });

    test("should return an RPCUrl for a supported network", () => {
      const rpcUrlOPS = getZeroDevBundlerRPCUrl(ESupportedChains.OptimismSepolia);
      expect(rpcUrlOPS).toBeDefined();

      const rpcUrlSepolia = getZeroDevBundlerRPCUrl(ESupportedChains.Sepolia);
      expect(rpcUrlSepolia).toBeDefined();

      const rpcUrlOP = getZeroDevBundlerRPCUrl(ESupportedChains.Optimism);
      expect(rpcUrlOP).toBeDefined();
    });

    test("should throw when a unsupported zero dev network is given", () => {
      expect(() => getZeroDevBundlerRPCUrl(ESupportedChains.Base)).toThrow(ErrorCodes.UNSUPPORTED_NETWORK.toString());
    });
  });

  describe("getBundlerClient", () => {
    test("should throw when the network is not supported", () => {
      expect(() => getBundlerClient("Unsupported" as ESupportedChains)).toThrow(
        ErrorCodes.UNSUPPORTED_NETWORK.toString(),
      );
    });
  });

  describe("getRpcUrl", () => {
    test("should throw when given an unsupported network", async () => {
      await expect(() => getRpcUrl("Unsupported" as ESupportedChains)).rejects.toThrow(
        ErrorCodes.UNSUPPORTED_NETWORK.toString(),
      );
    });

    test("should throw when the requested chain has no RPC configured", async () => {
      delete process.env.COORDINATOR_SEPOLIA_RPC_URL;
      delete process.env.COORDINATOR_SCROLL_SEPOLIA_RPC_URL;
      await expect(() => getRpcUrl(ESupportedChains.OptimismSepolia)).rejects.toThrow(
        ErrorCodes.COORDINATOR_RPC_URL_NOT_SET.toString(),
      );
    });

    test("should return each configured chain's own RPC url, not another chain's", async () => {
      process.env.COORDINATOR_SEPOLIA_RPC_URL = "https://example-sepolia.test";
      process.env.COORDINATOR_SCROLL_SEPOLIA_RPC_URL = "https://example-scroll-sepolia.test";

      await expect(getRpcUrl(ESupportedChains.Sepolia)).resolves.toBe("https://example-sepolia.test");
      await expect(getRpcUrl(ESupportedChains.ScrollSepolia)).resolves.toBe("https://example-scroll-sepolia.test");
    });

    test("should reject with a chain-specific error, never falling back to another chain's url, when a chain has no RPC configured", async () => {
      process.env.COORDINATOR_SEPOLIA_RPC_URL = "https://example-sepolia.test";
      delete process.env.COORDINATOR_SCROLL_SEPOLIA_RPC_URL;

      await expect(() => getRpcUrl(ESupportedChains.ScrollSepolia)).rejects.toThrow(ESupportedChains.ScrollSepolia);
      await expect(() => getRpcUrl(ESupportedChains.ScrollSepolia)).rejects.toThrow(
        ErrorCodes.COORDINATOR_RPC_URL_NOT_SET.toString(),
      );
    });
  });

  describe("viemChain", () => {
    test("should return correct chain for all supported networks", () => {
      expect(viemChain(ESupportedChains.Mainnet)).toBe(mainnet);
      expect(viemChain(ESupportedChains.Sepolia)).toBe(sepolia);
      expect(viemChain(ESupportedChains.Optimism)).toBe(optimism);
      expect(viemChain(ESupportedChains.OptimismSepolia)).toBe(optimismSepolia);
      expect(viemChain(ESupportedChains.Scroll)).toBe(scroll);
      expect(viemChain(ESupportedChains.ScrollSepolia)).toBe(scrollSepolia);
      expect(viemChain(ESupportedChains.Arbitrum)).toBe(arbitrum);
      expect(viemChain(ESupportedChains.ArbitrumSepolia)).toBe(arbitrumSepolia);
      expect(viemChain(ESupportedChains.Base)).toBe(base);
      expect(viemChain(ESupportedChains.BaseSepolia)).toBe(baseSepolia);
      expect(viemChain(ESupportedChains.Gnosis)).toBe(gnosis);
      expect(viemChain(ESupportedChains.GnosisChiado)).toBe(gnosisChiado);
      expect(viemChain(ESupportedChains.Polygon)).toBe(polygon);
      expect(viemChain(ESupportedChains.PolygonAmoy)).toBe(polygonAmoy);
      expect(viemChain(ESupportedChains.Linea)).toBe(linea);
      expect(viemChain(ESupportedChains.LineaSepolia)).toBe(lineaSepolia);
      expect(viemChain(ESupportedChains.ZkSyncEra)).toBe(zksync);
      expect(viemChain(ESupportedChains.ZkSyncSepolia)).toBe(zksyncSepoliaTestnet);
      expect(viemChain(ESupportedChains.PolygonZkEvm)).toBe(polygonZkEvm);
      expect(viemChain(ESupportedChains.PolygonCardonaZkEvm)).toBe(polygonZkEvmCardona);
      expect(viemChain(ESupportedChains.Hardhat)).toBe(hardhat);
      expect(viemChain(ESupportedChains.Localhost)).toBe(localhost);
    });

    test("should throw error for unsupported network", () => {
      expect(() => viemChain("UNSUPPORTED_NETWORK" as ESupportedChains)).toThrow(
        ErrorCodes.UNSUPPORTED_NETWORK.toString(),
      );
    });
  });
});
