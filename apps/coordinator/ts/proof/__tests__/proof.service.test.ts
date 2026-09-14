import { Keypair, PrivateKey } from "@znurznurznur/extended-maci-domainobjs";
import { Deployment, EMode, ESupportedChains, mergeSignups } from "@znurznurznur/extended-maci-sdk";
import dotenv from "dotenv";
import { zeroAddress } from "viem";

import type { IGenerateArgs, IMergeArgs } from "../types";

import { ErrorCodes } from "../../common";
import { getCoordinatorKeypair } from "../../common/coordinatorKeypair";
import { FileService } from "../../file/file.service";
import { SessionKeysService } from "../../sessionKeys/sessionKeys.service";
import { ProofGeneratorService } from "../proof.service";

dotenv.config();

jest.mock("@znurznurznur/extended-maci-sdk", (): unknown => ({
  ...jest.requireActual("@znurznurznur/extended-maci-sdk"),
  Deployment: {
    getInstance: jest.fn(),
  },
  getPoll: jest.fn().mockResolvedValue({
    address: "0x123",
  }),
  generateProofs: jest.fn().mockResolvedValue({
    processProofs: [1],
    tallyProofs: [1],
    tallyData: {},
  }),
  mergeSignups: jest.fn().mockResolvedValue({ status: 1 }),
}));

describe("ProofGeneratorService", () => {
  let defaultProofArgs: IGenerateArgs;
  let defaultMergeArgs: IMergeArgs;

  let mockContract = {
    polls: jest.fn(),
    getMainRoot: jest.fn(),
    treeDepths: jest.fn(),
    extContracts: jest.fn(),
    stateMerged: jest.fn(),
    coordinatorPublicKey: jest.fn(),
  };

  const defaultDeploymentService = {
    setHre: jest.fn(),
    getDeployer: jest.fn(() => Promise.resolve({})),
    getContract: jest.fn<Promise<typeof mockContract>, [{ signer?: { getAddress: () => Promise<string> } }]>(() =>
      Promise.resolve(mockContract),
    ),
  };
  const coordinatorPublicKey = getCoordinatorKeypair().publicKey.asContractParam();

  const fileService = new FileService();
  const sessionKeysService = new SessionKeysService(fileService);

  beforeAll(() => {
    defaultProofArgs = {
      poll: 1,
      maciContractAddress: zeroAddress,
      mode: EMode.NON_QV,
      // Must be a chain with a configured RPC url (see ts/common/chain.ts's
      // getConfiguredRpcUrl) since generate() resolves a real signer via getRpcUrl(chain)
      // when no sessionKeyAddress/approval are given.
      chain: ESupportedChains.Sepolia,
    };
    defaultMergeArgs = {
      pollId: 1,
      maciContractAddress: zeroAddress,
      chain: ESupportedChains.Sepolia,
    };
  });

  beforeEach(() => {
    mockContract = {
      polls: jest.fn(() =>
        Promise.resolve({ poll: zeroAddress.replace("0x0", "0x1"), messageProcessor: zeroAddress, tally: zeroAddress }),
      ),
      getMainRoot: jest.fn(() => Promise.resolve(1n)),
      treeDepths: jest.fn(() => Promise.resolve([1, 2, 3])),
      extContracts: jest.fn(() => Promise.resolve({ messageAq: zeroAddress })),
      stateMerged: jest.fn(() => Promise.resolve(true)),
      coordinatorPublicKey: jest.fn(() => Promise.resolve(coordinatorPublicKey)),
    };

    (Deployment.getInstance as jest.Mock).mockReturnValue(defaultDeploymentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("should throw error if private key is wrong", async () => {
    const keypair = new Keypair(new PrivateKey(0n));
    mockContract.coordinatorPublicKey.mockResolvedValue(keypair.publicKey.asContractParam());

    const service = new ProofGeneratorService(fileService, sessionKeysService);

    await expect(service.generate(defaultProofArgs)).rejects.toThrow(ErrorCodes.PRIVATE_KEY_MISMATCH.toString());
  });

  test("should generate proofs properly for NonQv", async () => {
    const service = new ProofGeneratorService(fileService, sessionKeysService);

    const data = await service.generate(defaultProofArgs);

    expect(data.processProofs).toHaveLength(1);
    expect(data.tallyProofs).toHaveLength(1);
  });

  test("should generate proofs properly for Qv", async () => {
    const service = new ProofGeneratorService(fileService, sessionKeysService);

    const data = await service.generate({ ...defaultProofArgs, mode: EMode.QV });

    expect(data.processProofs).toHaveLength(1);
    expect(data.tallyProofs).toHaveLength(1);
  });

  test("should pass the request-scoped signer into the Poll contract lookup", async () => {
    const service = new ProofGeneratorService(fileService, sessionKeysService);

    await service.generate(defaultProofArgs);

    // A real ethers Signer resolved for defaultProofArgs.chain must be passed through —
    // omitting it would silently fall back to Deployment's default hardhat-network deployer
    // instead of the chain this request actually targets (see research.md Decision 2).
    const [[getContractArgs]] = defaultDeploymentService.getContract.mock.calls;

    expect(getContractArgs.signer).toBeDefined();
    expect(typeof getContractArgs.signer?.getAddress).toBe("function");
  });

  describe("merge", () => {
    test("should return true when mergeSignups succeeds", async () => {
      const service = new ProofGeneratorService(fileService, sessionKeysService);

      await expect(service.merge(defaultMergeArgs)).resolves.toBe(true);
    });

    test("should return true (idempotent) when the state tree is already merged", async () => {
      (mergeSignups as jest.Mock).mockRejectedValueOnce(new Error("The state tree has already been merged"));

      const service = new ProofGeneratorService(fileService, sessionKeysService);

      // A retry after a previous attempt's generate/submit step failed shouldn't be blocked
      // just because merge itself already succeeded on that earlier attempt.
      await expect(service.merge(defaultMergeArgs)).resolves.toBe(true);
    });

    test("should rethrow any other merge failure", async () => {
      (mergeSignups as jest.Mock).mockRejectedValueOnce(new Error("Voting period is not over"));

      const service = new ProofGeneratorService(fileService, sessionKeysService);

      await expect(service.merge(defaultMergeArgs)).rejects.toThrow("Voting period is not over");
    });
  });
});
