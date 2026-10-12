/* eslint-disable no-console */
import { EMode } from "@maci-protocol/core";
import { type IVerifyingKeyObjectParams, VerifyingKey } from "@maci-protocol/domainobjs";
import { task } from "hardhat/config";

import type { IVerifyingKeyStruct } from "../../ts/types";
import type { VerifyingKeysRegistry } from "../../typechain-types";

import { info, logGreen } from "../../ts/logger";
import { extractVerifyingKey } from "../../ts/proofs";
import { ContractStorage } from "../helpers/ContractStorage";
import { Deployment } from "../helpers/Deployment";
import { EContracts } from "../helpers/types";

/**
 * Register ranked-mode verifying keys on an already-deployed VerifyingKeysRegistry.
 * Use this when the registry was deployed without ranked keys (deploy step 07 bug).
 */
task("setRankedVerifyingKeys", "Register ranked verifying keys on the deployed VerifyingKeysRegistry").setAction(
  async (_, hre) => {
    const deployment = Deployment.getInstance({ hre });
    deployment.setHre(hre);
    const storage = ContractStorage.getInstance();

    const deployer = await deployment.getDeployer();

    const stateTreeDepth = deployment.getDeployConfigField<number>(EContracts.VerifyingKeysRegistry, "stateTreeDepth");
    const tallyProcessingStateTreeDepth = deployment.getDeployConfigField<number>(
      EContracts.VerifyingKeysRegistry,
      "tallyProcessingStateTreeDepth",
    );
    const voteOptionTreeDepth = deployment.getDeployConfigField<number>(
      EContracts.VerifyingKeysRegistry,
      "voteOptionTreeDepth",
    );
    const messageBatchSize = deployment.getDeployConfigField<number>(
      EContracts.VerifyingKeysRegistry,
      "messageBatchSize",
    );

    const messageProcessorZkeyPath = deployment.getDeployConfigField<string>(
      EContracts.VerifyingKeysRegistry,
      "zkeys.ranked.messageProcessorZkey",
    );
    const voteTallyZkeyPath = deployment.getDeployConfigField<string>(
      EContracts.VerifyingKeysRegistry,
      "zkeys.ranked.voteTallyZkey",
    );

    if (!messageProcessorZkeyPath || !voteTallyZkeyPath) {
      throw new Error("Ranked zkeys are not configured in deploy-config.json under VerifyingKeysRegistry.zkeys.ranked");
    }

    console.log(info(`Extracting ranked verifying keys...`));
    console.log(info(`  processMessagesZkey: ${messageProcessorZkeyPath}`));
    console.log(info(`  voteTallyZkey:       ${voteTallyZkeyPath}`));

    const [rankedProcessVk, rankedTallyVk] = await Promise.all([
      extractVerifyingKey(messageProcessorZkeyPath),
      extractVerifyingKey(voteTallyZkeyPath),
    ]).then((vks) =>
      vks.map((vk: IVerifyingKeyObjectParams) => VerifyingKey.fromObj(vk).asContractParam() as IVerifyingKeyStruct),
    );

    const registryAddress = storage.mustGetAddress(EContracts.VerifyingKeysRegistry, hre.network.name);
    const registry = await deployment.getContract<VerifyingKeysRegistry>({
      name: EContracts.VerifyingKeysRegistry,
      address: registryAddress,
    });

    console.log(info(`Calling setVerifyingKeys on ${registryAddress} for ranked mode...`));
    console.log(info(`  stateTreeDepth:               ${stateTreeDepth}`));
    console.log(info(`  tallyProcessingStateTreeDepth: ${tallyProcessingStateTreeDepth}`));
    console.log(info(`  voteOptionTreeDepth:           ${voteOptionTreeDepth}`));
    console.log(info(`  messageBatchSize:              ${messageBatchSize}`));
    console.log(info(`  mode:                          ${EMode.RANKED} (RANKED)`));

    const tx = await registry
      .connect(deployer)
      .setVerifyingKeys(
        stateTreeDepth,
        tallyProcessingStateTreeDepth,
        voteOptionTreeDepth,
        messageBatchSize,
        EMode.RANKED,
        rankedProcessVk,
        rankedTallyVk,
      );

    await tx.wait();

    logGreen({ text: info("Ranked verifying keys registered successfully.") });
  },
);
