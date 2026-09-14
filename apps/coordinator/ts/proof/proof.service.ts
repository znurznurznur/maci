import { Logger, Injectable } from "@nestjs/common";
import { PublicKey } from "@znurznurznur/extended-maci-domainobjs";
import {
  Deployment,
  EContracts,
  type Poll,
  type IGenerateProofsOptions,
  getPoll,
  mergeSignups,
  EMode,
} from "@znurznurznur/extended-maci-sdk";
import { IProof, ITallyData, generateProofs, proveOnChain } from "@znurznurznur/extended-maci-sdk";
import hre from "hardhat";

import fs from "fs";
import path from "path";

import type { IGenerateArgs, IGenerateData, IMergeArgs, ISubmitProofsArgs } from "./types";

import { ErrorCodes } from "../common";
import { getCoordinatorKeypair } from "../common/coordinatorKeypair";
import { FileService } from "../file/file.service";
import { SessionKeysService } from "../sessionKeys/sessionKeys.service";

/**
 * ProofGeneratorService is responsible for generating message processing and tally proofs.
 */
@Injectable()
export class ProofGeneratorService {
  /**
   * Deployment helper
   */
  private readonly deployment: Deployment;

  /**
   * Logger
   */
  private readonly logger: Logger;

  /**
   * Proof generator initialization
   */
  constructor(
    private readonly fileService: FileService,
    private readonly sessionKeysService: SessionKeysService,
  ) {
    this.deployment = Deployment.getInstance({ hre });
    this.deployment.setHre(hre);
    this.logger = new Logger(ProofGeneratorService.name);
  }

  /**
   * Read and parse proofs
   * @param folder - folder path to read proofs from
   * @param type - type of proofs to read (tally or process)
   * @returns proofs
   */
  async readProofs(folder: string, type: "tally" | "process"): Promise<IProof[]> {
    const files = await fs.promises.readdir(folder);
    return Promise.all(
      files
        .filter((f) => f.startsWith(`${type}_`) && f.endsWith(".json"))
        .sort()
        .map(async (file) =>
          fs.promises.readFile(`${folder}/${file}`, "utf8").then((result) => JSON.parse(result) as IProof),
        ),
    );
  }

  /**
   * Generate proofs for message processing and tally
   *
   * @param args - generate proofs arguments
   * @returns - generated proofs for message processing and tally
   */
  async generate(
    {
      approval,
      sessionKeyAddress,
      chain,
      poll,
      maciContractAddress,
      mode,
      startBlock,
      endBlock,
      blocksPerBatch,
      useWasm,
    }: IGenerateArgs,
    options?: IGenerateProofsOptions,
  ): Promise<IGenerateData> {
    try {
      const signer = await this.sessionKeysService.getCoordinatorSigner(chain, sessionKeyAddress, approval);

      const pollData = await getPoll({
        maciAddress: maciContractAddress,
        pollId: poll,
        signer,
      });

      const pollContract = await this.deployment.getContract<Poll>({
        name: EContracts.Poll,
        address: pollData.address,
        // Without this, getContract() falls back to hardhat's default-network deployer
        // (hardhat.config.cjs's single "localhost" network) instead of the chain this
        // request actually targets — see specs/009-coordinator-multi-chain-rpc/research.md
        // Decision 2.
        signer,
      });

      const publicKeyOnChain = await pollContract.coordinatorPublicKey();
      const coordinatorPublicKeyOnChain = new PublicKey([
        BigInt(publicKeyOnChain.x.toString()),
        BigInt(publicKeyOnChain.y.toString()),
      ]);

      const coordinatorKeypair = getCoordinatorKeypair();

      if (!coordinatorKeypair.publicKey.equals(coordinatorPublicKeyOnChain)) {
        this.logger.error(`Error: ${ErrorCodes.PRIVATE_KEY_MISMATCH}, wrong private key`);
        throw new Error(ErrorCodes.PRIVATE_KEY_MISMATCH.toString());
      }

      // There are only QV and Non-QV modes available for tally circuit
      const tally = this.fileService.getZkeyFilePaths(
        process.env.COORDINATOR_TALLY_ZKEY_NAME!,
        // if FULL use NON_QV because there are only VoteTallyQV and VoteTallyNonQV zkeys
        mode === EMode.FULL ? EMode.NON_QV : mode,
      );
      const messageProcessor = this.fileService.getZkeyFilePaths(
        process.env.COORDINATOR_MESSAGE_PROCESS_ZKEY_NAME!,
        mode,
      );

      const { processProofs, tallyProofs, tallyData } = await generateProofs({
        outputDir: path.resolve("./proofs"),
        coordinatorPrivateKey: coordinatorKeypair.privateKey.serialize(),
        signer,
        maciAddress: maciContractAddress,
        pollId: BigInt(poll),
        startBlock,
        endBlock,
        blocksPerBatch,
        useWasm,
        rapidsnark: process.env.COORDINATOR_RAPIDSNARK_EXE,
        mode,
        voteTallyZkey: tally.zkey,
        voteTallyWitnessGenerator: tally.witnessGenerator,
        voteTallyWasm: tally.wasm,
        messageProcessorZkey: messageProcessor.zkey,
        messageProcessorWitnessGenerator: messageProcessor.witnessGenerator,
        messageProcessorWasm: messageProcessor.wasm,
        tallyFile: path.resolve("./tally.json"),
      });

      return {
        processProofs,
        tallyProofs,
        tallyData,
      };
    } catch (error) {
      options?.onFail?.(error as Error);
      throw error;
    }
  }

  /**
   * Merge state and message trees
   *
   * @param args - merge arguments
   * @returns whether the proofs were successfully merged
   */
  async merge({ maciContractAddress, pollId, approval, sessionKeyAddress, chain }: IMergeArgs): Promise<boolean> {
    const signer = await this.sessionKeysService.getCoordinatorSigner(chain, sessionKeyAddress, approval);

    try {
      await mergeSignups({
        maciAddress: maciContractAddress,
        pollId: BigInt(pollId),
        signer,
      });
    } catch (error) {
      // Idempotent: the caller's goal ("the state tree is merged") is already satisfied, so
      // a retry after a previous attempt's later step (generate/submit) failed shouldn't be
      // blocked here just because merge itself already succeeded — see
      // packages/sdk/ts/maci/merge.ts, which throws in this specific case rather than
      // treating it as a no-op (correct for direct CLI use, where a human should be told
      // "you already did this"; not correct for this HTTP endpoint, which
      // apps/zugov-backend's runTallyPipeline calls unconditionally as step 1 of 3 on every
      // retry).
      if (!(error as Error).message.includes("already been merged")) {
        throw error;
      }
    }

    return true;
  }

  /**
   * Submit proofs on-chain
   *
   * @param args - submit proofs on-chain arguments
   */
  async submit({
    maciContractAddress,
    pollId,
    sessionKeyAddress,
    approval,
    chain,
  }: ISubmitProofsArgs): Promise<ITallyData> {
    const signer = await this.sessionKeysService.getCoordinatorSigner(chain, sessionKeyAddress, approval);

    const tallyData = await proveOnChain({
      pollId: BigInt(pollId),
      maciAddress: maciContractAddress,
      proofDir: "./proofs",
      tallyFile: "./tally.json",
      signer,
    });

    if (!tallyData) {
      throw new Error("Tally data is undefined");
    }

    return tallyData;
  }
}
