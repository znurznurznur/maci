/* eslint-disable no-console */
import { PublicKey } from "@maci-protocol/domainobjs";
import hre, { ethers, network } from "hardhat";

import type { ZuGovRegistry } from "../typechain-types";

import { ContractStorage } from "../tasks/helpers/ContractStorage";
import { Deployment } from "../tasks/helpers/Deployment";
import { EContracts } from "../tasks/helpers/types";

const storage = ContractStorage.getInstance();

/**
 * One-off admin utility: updates an already-deployed ZuGovRegistry's coordinator public key
 * (and only that field — every other Infrastructure field is re-submitted unchanged) without
 * redeploying the registry. tasks/deploy/zugov/01-registry.ts's deploy step only sets
 * coordinatorPublicKey correctly on a *fresh* deploy; this is for updating an existing one.
 *
 * Usage: npx hardhat run scripts/setRegistryCoordinatorKey.ts --network <network>
 * Reads the new key from deploy-config.json's ZuGovRegistry.coordinatorPublicKey field (same
 * field the deploy task itself now reads, per that fix).
 */
async function main(): Promise<void> {
  const deployment = Deployment.getInstance();
  deployment.setHre(hre);

  const registryAddress = storage.mustGetAddress(EContracts.ZuGovRegistry, network.name);
  const registry = (await ethers.getContractAt(EContracts.ZuGovRegistry, registryAddress)) as unknown as ZuGovRegistry;

  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  const owner = await registry.owner();

  if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error(
      `Configured signer ${signerAddress} is not the registry owner (${owner}) — aborting without sending a transaction.`,
    );
  }

  const current = await registry.getInfrastructure();

  const coordinatorPublicKey = deployment.getDeployConfigField<string>(
    EContracts.ZuGovRegistry,
    "coordinatorPublicKey",
  );
  const coordinatorKey = PublicKey.deserialize(coordinatorPublicKey);

  console.log(`Registry: ${registryAddress} on ${network.name}`);
  console.log(`Current coordinatorPubKeyX/Y: ${current.coordinatorPubKeyX} / ${current.coordinatorPubKeyY}`);
  console.log(`New coordinatorPubKeyX/Y:     ${coordinatorKey.raw[0]} / ${coordinatorKey.raw[1]}`);

  const tx = await registry.setInfrastructure({
    pollFactory: current.pollFactory,
    messageProcessorFactory: current.messageProcessorFactory,
    tallyFactory: current.tallyFactory,
    verifier: current.verifier,
    verifyingKeysRegistry: current.verifyingKeysRegistry,
    poseidonT3: current.poseidonT3,
    poseidonT4: current.poseidonT4,
    poseidonT5: current.poseidonT5,
    poseidonT6: current.poseidonT6,
    signUpPolicy: current.signUpPolicy,
    coordinatorPubKeyX: coordinatorKey.raw[0],
    coordinatorPubKeyY: coordinatorKey.raw[1],
  });

  console.log(`tx sent: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`confirmed in block ${receipt?.blockNumber}`);

  const updated = await registry.getInfrastructure();
  console.log(`Post-update coordinatorPubKeyX/Y: ${updated.coordinatorPubKeyX} / ${updated.coordinatorPubKeyY}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
