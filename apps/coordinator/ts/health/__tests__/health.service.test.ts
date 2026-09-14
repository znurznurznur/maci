import { EMode } from "@extended-maci/contracts";
import { ESupportedChains } from "@extended-maci/sdk";
import dotenv from "dotenv";
import { JsonRpcProvider } from "ethers";
import { zeroAddress } from "viem";

import fs, { type Stats } from "fs";

import { FileService } from "../../file/file.service";
import { type RedisService } from "../../redis/redis.service";
import { HealthService } from "../health.service";

dotenv.config();

describe("HealthService", () => {
  const fileService = new FileService();
  const mockRedisService = {
    isOpen: jest.fn().mockReturnValue(true),
  } as unknown as RedisService;

  const healthService = new HealthService(fileService, mockRedisService);

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("checkRapidsnark", () => {
    test("should return rapidsnark path and executability status", async () => {
      jest.spyOn(fs.promises, "access").mockImplementation(() => Promise.resolve());
      jest
        .spyOn(fs.promises, "stat")
        .mockImplementation(() => Promise.resolve({ isFile: () => true } as unknown as Stats));

      const response = await healthService.checkRapidsnark();

      expect(response.rapidsnarkExecutablePath).toBe(process.env.COORDINATOR_RAPIDSNARK_EXE);
      expect(response.rapidsnarkIsAccessible).toBe(true);
      expect(response.rapidsnarkIsExecutable).toBe(true);
    });

    test("should return false when rapidsnark path is not set", async () => {
      jest.spyOn(fs.promises, "access").mockImplementation(() => Promise.reject(new Error()));
      jest.spyOn(fs.promises, "stat").mockImplementation(() => Promise.reject(new Error()));

      process.env.COORDINATOR_RAPIDSNARK_EXE = "/incorrect/path/to/rapidsnark";
      const response = await healthService.checkRapidsnark();

      expect(response.rapidsnarkIsAccessible).toBe(false);
      expect(response.rapidsnarkIsExecutable).toBe(false);
    });
  });

  describe("checkZkeysDirectory", () => {
    test("should return if zkeys directory exists and the available zkeys paths", async () => {
      jest
        .spyOn(fs.promises, "stat")
        .mockImplementation(() => Promise.resolve({ isDirectory: () => true } as unknown as Stats));

      const { zkeysDirectoryExists, availableZkeys } = await healthService.checkZkeysDirectory();
      const numberofZkeys = Object.keys(availableZkeys).length;

      const expectedNumberOfZkeys =
        1 + // poll joining zkey
        1 + // poll joined zkey
        3 + // message process zkey for modes (QV, NON_QV, FULL)
        2; // vote tally zkey for modes (only QV and NON_QV)

      expect(zkeysDirectoryExists).toBe(true);
      expect(numberofZkeys).toBe(expectedNumberOfZkeys);
    });

    test("should return less available zkeys when COORDINATOR_POLL_JOINING_ZKEY_NAME is not set in the env file", async () => {
      process.env.COORDINATOR_POLL_JOINING_ZKEY_NAME = "/incorrect/path/to/poll_joining";
      const { availableZkeys } = await healthService.checkZkeysDirectory();

      expect(availableZkeys[process.env.COORDINATOR_POLL_JOINING_ZKEY_NAME]).toBe(undefined);
    });

    test("should return less available zkeys when COORDINATOR_POLL_JOINED_ZKEY_NAME is not set in the env file", async () => {
      process.env.COORDINATOR_POLL_JOINED_ZKEY_NAME = "/incorrect/path/to/poll_joined";
      const { availableZkeys } = await healthService.checkZkeysDirectory();

      expect(availableZkeys[process.env.COORDINATOR_POLL_JOINED_ZKEY_NAME]).toBe(undefined);
    });

    test("should return less available zkeys when COORDINATOR_TALLY_ZKEY_NAME is not set in the env file", async () => {
      process.env.COORDINATOR_TALLY_ZKEY_NAME = "/incorrect/path/to/tally_zkey";
      const { availableZkeys } = await healthService.checkZkeysDirectory();

      expect(availableZkeys[`${process.env.COORDINATOR_TALLY_ZKEY_NAME}_Mode_${String(EMode.NON_QV)}`]).toBe(undefined);
      expect(availableZkeys[`${process.env.COORDINATOR_TALLY_ZKEY_NAME}_Mode_${String(EMode.QV)}`]).toBe(undefined);
    });

    test("should return less available zkeys when COORDINATOR_MESSAGE_PROCESS_ZKEY_NAME is not set in the env file", async () => {
      process.env.COORDINATOR_MESSAGE_PROCESS_ZKEY_NAME = "/incorrect/path/to/message_process_zkey";
      const { availableZkeys } = await healthService.checkZkeysDirectory();

      expect(availableZkeys[`${process.env.COORDINATOR_MESSAGE_PROCESS_ZKEY_NAME}_Mode_${String(EMode.NON_QV)}`]).toBe(
        undefined,
      );
      expect(availableZkeys[`${process.env.COORDINATOR_MESSAGE_PROCESS_ZKEY_NAME}_Mode_${String(EMode.QV)}`]).toBe(
        undefined,
      );
      expect(availableZkeys[`${process.env.COORDINATOR_MESSAGE_PROCESS_ZKEY_NAME}_Mode_${String(EMode.FULL)}`]).toBe(
        undefined,
      );
    });

    test("should return false when zkeys directory is not set", async () => {
      jest.spyOn(fs.promises, "stat").mockImplementation(() => Promise.reject(new Error()));

      process.env.COORDINATOR_ZKEY_PATH = "/incorrect/path/to/zkeys";
      const { zkeysDirectoryExists } = await healthService.checkZkeysDirectory();

      expect(zkeysDirectoryExists).toBe(false);
    });
  });

  describe("checkWalletFunds", () => {
    beforeEach(() => {
      // Avoid depending on real RPC endpoints being reachable in tests — chain resolution
      // itself (getRpcUrl/getSigner) still runs for real, only the network call is stubbed.
      jest.spyOn(JsonRpcProvider.prototype, "getBalance").mockResolvedValue(1_000_000_000_000_000_000n);
    });

    test("should return the wallet address for a chain with RPC configured", async () => {
      const { fundsInNetworks } = await healthService.checkWalletFunds();
      const sepoliaFunds = fundsInNetworks.find((entry) => entry.network === String(ESupportedChains.Sepolia));

      expect(sepoliaFunds?.address).toBeDefined();
      expect(sepoliaFunds?.address).not.toBe(zeroAddress);
      expect(sepoliaFunds?.status).toBe(true);
    });

    test("should return distinct entries for both configured chains, and zeroAddress/false for an unconfigured one", async () => {
      const { fundsInNetworks } = await healthService.checkWalletFunds();
      const sepoliaFunds = fundsInNetworks.find((entry) => entry.network === String(ESupportedChains.Sepolia));
      const scrollSepoliaFunds = fundsInNetworks.find(
        (entry) => entry.network === String(ESupportedChains.ScrollSepolia),
      );
      const mainnetFunds = fundsInNetworks.find((entry) => entry.network === String(ESupportedChains.Mainnet));

      expect(sepoliaFunds?.status).toBe(true);
      expect(scrollSepoliaFunds?.status).toBe(true);
      // Mainnet has no COORDINATOR_*_RPC_URL configured (ts/common/chain.ts) — it must fail
      // closed, never silently reuse Sepolia's or Scroll Sepolia's endpoint/result.
      expect(mainnetFunds?.address).toBe(zeroAddress);
      expect(mainnetFunds?.status).toBe(false);
      expect(mainnetFunds?.error).toContain(ESupportedChains.Mainnet);
    });

    test("should return 0x if coordinator private key is not set", async () => {
      process.env.PRIVATE_KEY = "";
      process.env.MNEMONIC = "";
      const { fundsInNetworks } = await healthService.checkWalletFunds();
      const sepoliaFunds = fundsInNetworks.find((entry) => entry.network === String(ESupportedChains.Sepolia));

      expect(sepoliaFunds?.address).toBe(zeroAddress);
    });
  });

  describe("checkRedisConnection", () => {
    test("should return true if Redis connection is open", () => {
      const isRedisOpen = healthService.checkRedisConnection();

      expect(isRedisOpen).toBe(true);
    });
  });
});
