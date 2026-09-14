/* eslint-disable no-console */
import { EMode, EPolicy } from "@znurznurznur/extended-maci-core";
import hre, { ethers, network } from "hardhat";

import type { MACI, IBasePolicy } from "../typechain-types";

import { generateEmptyBallotRoots } from "../ts/generateEmptyBallotRoots";

/**
 * One-off real end-to-end test: deploys a fresh sign-up policy + MACI contract on `network`
 * (mirroring apps/zugov-frontend/src/hooks/useCreateCommunity.ts's real deployment sequence
 * exactly — FreeForAll sign-up policy clone, then MACI linked against the real ZuGovRegistry
 * infra, then setTarget), then registers the result with the real local backend exactly as the
 * wizard's "save_community" phase does.
 *
 * Usage: npx hardhat run scripts/testCreateCommunity.ts --network sepolia
 */

const REGISTRY_ADDRESS = "0xa26FEBCaa0aBaa9cc303F07f1320cf1125f675dD";
const REGISTRY_ABI = [
  {
    type: "function",
    name: "getInfrastructure",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "pollFactory", type: "address" },
          { name: "messageProcessorFactory", type: "address" },
          { name: "tallyFactory", type: "address" },
          { name: "verifier", type: "address" },
          { name: "verifyingKeysRegistry", type: "address" },
          { name: "poseidonT3", type: "address" },
          { name: "poseidonT4", type: "address" },
          { name: "poseidonT5", type: "address" },
          { name: "poseidonT6", type: "address" },
          { name: "signUpPolicy", type: "address" },
          { name: "coordinatorPubKeyX", type: "uint256" },
          { name: "coordinatorPubKeyY", type: "uint256" },
        ],
      },
    ],
  },
];

// Real deployed sign-up-policy factory addresses on sepolia — apps/zugov-frontend/src/generated/sepolia.ts
const FREE_FOR_ALL_CHECKER_FACTORY = "0xa87fCEB0064f064b6a5Fa54AF85014a24ce99162";
const FREE_FOR_ALL_POLICY_FACTORY = "0x4dF289F131b388bC805995adBB1006471e2cEedD";

const CLONE_DEPLOYED_EVENT_ABI = ["event CloneDeployed(address indexed clone)"];
const CHECKER_DEPLOY_ABI = ["function deploy() returns (address)"];
const POLICY_DEPLOY_ABI = ["function deploy(address checkerAddress) returns (address)"];

const BACKEND_URL = "http://localhost:3001";

interface RegistryInfrastructure {
  pollFactory: string;
  messageProcessorFactory: string;
  tallyFactory: string;
  verifier: string;
  verifyingKeysRegistry: string;
  poseidonT3: string;
  poseidonT4: string;
  poseidonT5: string;
  poseidonT6: string;
  signUpPolicy: string;
  coordinatorPubKeyX: bigint;
  coordinatorPubKeyY: bigint;
}

function extractCloneAddress(logs: readonly { topics: readonly string[]; data: string }[]): string {
  const iface = new ethers.Interface(CLONE_DEPLOYED_EVENT_ABI);
  const cloneDeployedTopic = iface.getEvent("CloneDeployed")!.topicHash;
  const log = logs.find((entry) => entry.topics[0] === cloneDeployedTopic);
  if (!log) {
    throw new Error("CloneDeployed event not found");
  }
  const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
  return parsed!.args[0] as string;
}

async function main(): Promise<void> {
  const [signer] = await ethers.getSigners();
  const deployerAddress = await signer.getAddress();
  console.log(`Deployer: ${deployerAddress} on ${network.name}`);

  const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, signer);
  const infra = (await registry.getInfrastructure()) as unknown as RegistryInfrastructure;
  console.log("Read real ZuGovRegistry infrastructure — OK");

  // Phase 1: deploy a FreeForAll sign-up policy (checker clone, then policy clone)
  console.log("Deploying FreeForAll checker clone (tx 1/3)...");
  const checkerIface = new ethers.Interface(CHECKER_DEPLOY_ABI);
  const checkerTx = await signer.sendTransaction({
    to: FREE_FOR_ALL_CHECKER_FACTORY,
    data: checkerIface.encodeFunctionData("deploy", []),
  });
  const checkerReceipt = await checkerTx.wait();
  const checkerAddress = extractCloneAddress(checkerReceipt!.logs);
  console.log(`  checker: ${checkerAddress}`);

  console.log("Deploying FreeForAll policy clone (tx 2/3)...");
  const policyIface = new ethers.Interface(POLICY_DEPLOY_ABI);
  const policyTx = await signer.sendTransaction({
    to: FREE_FOR_ALL_POLICY_FACTORY,
    data: policyIface.encodeFunctionData("deploy", [checkerAddress]),
  });
  const policyReceipt = await policyTx.wait();
  const signUpPolicyAddress = extractCloneAddress(policyReceipt!.logs);
  console.log(`  policy: ${signUpPolicyAddress}`);

  // Phase 2: deploy MACI, linked against the real registry's shared infra
  console.log("Deploying MACI contract (tx 3/3)...");
  const libraries = {
    "contracts/crypto/PoseidonT3.sol:PoseidonT3": infra.poseidonT3,
    "contracts/crypto/PoseidonT4.sol:PoseidonT4": infra.poseidonT4,
    "contracts/crypto/PoseidonT5.sol:PoseidonT5": infra.poseidonT5,
    "contracts/crypto/PoseidonT6.sol:PoseidonT6": infra.poseidonT6,
  };
  const maciFactory = await hre.ethers.getContractFactory("MACI", { signer, libraries });

  const stateTreeDepth = 10;
  const emptyBallotRoots = generateEmptyBallotRoots(stateTreeDepth) as [bigint, bigint, bigint, bigint, bigint];
  const initialSupportedModes = [EMode.NON_QV];
  const initialAllowedPolicies = [EPolicy.FreeForAll];

  const maciContract = (await maciFactory.deploy({
    pollFactory: infra.pollFactory,
    messageProcessorFactory: infra.messageProcessorFactory,
    tallyFactory: infra.tallyFactory,
    signUpPolicy: signUpPolicyAddress,
    verifier: infra.verifier,
    verifyingKeysRegistry: infra.verifyingKeysRegistry,
    stateTreeDepth,
    emptyBallotRoots,
    owner: deployerAddress,
    initialSupportedModes,
    initialAllowedPolicies,
  })) as unknown as MACI;
  await maciContract.waitForDeployment();
  const maciAddress = await maciContract.getAddress();
  console.log(`  MACI: ${maciAddress}`);

  // Phase 3: authorize MACI on the sign-up policy
  console.log("Setting policy target...");
  const policyContract = (await ethers.getContractAt(
    "IBasePolicy",
    signUpPolicyAddress,
    signer,
  )) as unknown as IBasePolicy;
  await policyContract.setTarget(maciAddress).then((tx) => tx.wait());

  // Phase 4: register with the real backend, matching the wizard's save_community payload shape
  console.log("Registering community with backend...");
  const payload = {
    id: maciAddress,
    displayName: "Sepolia Live Test Community",
    description: "Created end-to-end via a real script test (scripts/testCreateCommunity.ts).",
    logo: "\u{1F3DB}\u{FE0F}",
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    creatorAddress: deployerAddress,
    allowedPolicies: initialAllowedPolicies,
    supportedModes: initialSupportedModes,
    signUpPolicyType: "FreeForAll",
    signUpPolicyAddress,
    stateTreeDepth,
    source: "wizard",
    membershipPolicy: "open",
    tierChangesRequireVote: false,
    tiers: [{ label: "Member", canCreateProposals: true, canVote: true, canManageMembership: true }],
    defaultTierLabel: "Member",
  };

  const res = await fetch(`${BACKEND_URL}/api/communities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body: unknown = await res.json();
  console.log(`Backend registration: ${res.status}`, JSON.stringify(body, null, 2));

  console.log("\nDone.");
  console.log(`MACI contract:     ${maciAddress}`);
  console.log(`Sign-up policy:    ${signUpPolicyAddress}`);
  console.log(`View in frontend:  http://localhost:5173/community/${maciAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
