import { HttpException, HttpStatus } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { EMode, ESupportedChains, type ITallyData } from "@znurznurznur/extended-maci-sdk";

import type { IGetPublicKeyData } from "../../file/types";
import type { IGenerateArgs, IGenerateData, IMergeArgs } from "../types";

import { ErrorCodes } from "../../common";
import { FileService } from "../../file/file.service";
import { ProofController } from "../proof.controller";
import { ProofGeneratorService } from "../proof.service";

describe("ProofController", () => {
  let proofController: ProofController;

  const defaultProofGeneratorArgs: IGenerateArgs = {
    poll: 0,
    maciContractAddress: "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e",
    mode: EMode.NON_QV,
    sessionKeyAddress: "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e",
    approval: "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e",
    chain: ESupportedChains.Localhost,
  };

  const defaultMergeArgs: IMergeArgs = {
    maciContractAddress: "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e",
    pollId: 0,
    sessionKeyAddress: "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e",
    approval: "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e",
    chain: ESupportedChains.Localhost,
  };

  const defaultProofGeneratorData: IGenerateData = {
    tallyProofs: [],
    processProofs: [],
    tallyData: {} as ITallyData,
  };

  const defaultPublicKeyData: IGetPublicKeyData = {
    publicKey: "key",
  };

  const mockGeneratorService = {
    generate: jest.fn(),
    merge: jest.fn(),
  };

  const mockFileService = {
    getPublicKey: jest.fn(),
  };

  beforeEach(async () => {
    const app = await Test.createTestingModule({
      controllers: [ProofController],
    })
      .useMocker((token) => {
        if (token === ProofGeneratorService) {
          mockGeneratorService.generate.mockResolvedValue(defaultProofGeneratorData);
          mockGeneratorService.merge.mockResolvedValue(true);

          return mockGeneratorService;
        }

        if (token === FileService) {
          mockFileService.getPublicKey.mockResolvedValue(defaultPublicKeyData);

          return mockFileService;
        }

        return jest.fn();
      })
      .compile();

    proofController = app.get<ProofController>(ProofController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("v1/proof/generate", () => {
    test("should return generated proof data", async () => {
      const data = await proofController.generate(defaultProofGeneratorArgs);
      expect(data).toStrictEqual(defaultProofGeneratorData);
    });

    test("should throw an error if proof generation is failed", async () => {
      const error = new Error("error");
      mockGeneratorService.generate.mockRejectedValue(error);

      await expect(proofController.generate(defaultProofGeneratorArgs)).rejects.toThrow(
        new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });

  describe("v1/proof/merge", () => {
    test("should return true when there are no errors", async () => {
      const data = await proofController.merge(defaultMergeArgs);
      expect(data).toBe(true);
    });

    test("should return a chain-specific 500 error when the requested chain has no RPC configured", async () => {
      const chain = ESupportedChains.ScrollSepolia;
      const error = new Error(`${ErrorCodes.COORDINATOR_RPC_URL_NOT_SET.toString()}: ${chain}`);
      mockGeneratorService.merge.mockRejectedValue(error);

      await expect(proofController.merge({ ...defaultMergeArgs, chain })).rejects.toThrow(
        new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });

  describe("v1/proof/publicKey", () => {
    test("should return public key properly", async () => {
      const data = await proofController.getPublicKey();
      expect(data).toStrictEqual(defaultPublicKeyData);
    });

    test("should throw an error if file service throws an error", async () => {
      const error = new Error("error");
      mockFileService.getPublicKey.mockRejectedValue(error);

      await expect(proofController.getPublicKey()).rejects.toThrow(
        new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });
});
