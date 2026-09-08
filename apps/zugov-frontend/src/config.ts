import { scrollSepolia, sepolia } from "wagmi/chains";
import type { Hex } from "viem";

import * as sepoliaDeployment from "./generated/sepolia";

// System 2 of 3 identity/eligibility vocabularies (see ENGINEERING.md's Decisions Log,
// 2026-09-01) — governs MACI POLL VOTER REGISTRATION, frontend/on-chain only, never read by
// backend authorization code. Distinct from EligibilityMechanism (community/tier join,
// eligibilityService.ts) and credential verification (IdentityProvider.ts / credentialStore.ts).
export type SignUpPolicyType =
  | "FreeForAll"
  | "Zupass"
  | "EAS"
  | "GitcoinPassport"
  | "Semaphore"
  | "AnonAadhaar"
  | "ERC20Token"
  | "ERC20Votes"
  | "Token"
  | "MerkleProof"
  | "HatsProtocol";

export type SignUpPolicyArgs =
  | { type: "FreeForAll" }
  | { type: "Zupass"; eventId: string; signer1: string; signer2: string }
  | { type: "EAS"; schemaUid: Hex; attesterAddress: Hex }
  | { type: "GitcoinPassport"; thresholdScore: number }
  | { type: "Semaphore"; groupId: string }
  | { type: "AnonAadhaar"; nullifierSeed: bigint }
  | { type: "ERC20Token"; tokenAddress: Hex; threshold: bigint }
  | { type: "ERC20Votes"; tokenAddress: Hex; threshold: bigint; snapshotBlock: bigint }
  | { type: "Token"; tokenAddress: Hex }
  | { type: "MerkleProof"; merkleRoot: Hex }
  | { type: "HatsProtocol"; criterionHats: string[] };

export const GovernanceTypes = {
  MACI: "maci",
} as const;

// Mirrors the constitution's "Mechanism families" list (Technical Stack & Constraints). Only
// `maci` has a working adapter today — `tokenWeighted`/`offchain` are listed so the community
// creation wizard's voting-mechanism step is a real, honest selector (Constitution Principle I:
// "a community selects its mechanism family at creation time") without pretending those two are
// usable yet (Principle V: no speculative features — no new adapter is implemented here,
// specs/010 research.md #8).
export const MECHANISM_FAMILIES = [
  {
    value: "maci",
    label: "MACI",
    description: "Private, collusion-resistant voting using zero-knowledge proofs.",
    enabled: true,
  },
  { value: "tokenWeighted", label: "Token-weighted", description: "ERC-20 voting power, on-chain.", enabled: false },
  { value: "offchain", label: "Off-chain", description: "Snapshot-style, signed message aggregation.", enabled: false },
] as const;

/** Numeric string matching the on-chain DomainObjs.Policy enum */
export const PolicyType = {
  ERC20: "0",
  FreeForAll: "1",
  MerkleProof: "2",
  ERC20Votes: "3",
  EAS: "4",
  GitcoinPassport: "5",
  Zupass: "6",
  Semaphore: "7",
  AnonAadhaar: "8",
  Token: "9",
  Hats: "10",
} as const;

export const maciArtifacts = {
  pollJoiningZkeyUrl: "/PollJoining_10_test.0.zkey",
  pollJoiningWasmUrl: "/PollJoining_10_test.wasm",
} as const;

export type GovernanceType = (typeof GovernanceTypes)[keyof typeof GovernanceTypes];

// Adding a chain here also requires updating two backend-side places that key off chainId, or
// that chain's communities will silently fail subgraph deployment (subgraphStatus stays
// "failed", nothing surfaced in the UI): apps/zugov-backend/src/services/chainRpc.ts's
// NETWORK_NAMES/RPC_URLS maps, and graph-node's `ethereum:` network list in
// deploy/docker-compose.yml.
export const supportedChains = [scrollSepolia, sepolia] as const;

/**
 * Fixed circuit-parameter constants for poll deployment, matching the only zkeys this frontend
 * ships (stateTreeDepth 10 — see public/PollJoining_10_test.{0.zkey,wasm}) and the same values
 * already used for Sepolia's own Poll deploy task
 * (packages/contracts/deploy-config-example.json's sepolia.VerifyingKeysRegistry section).
 */
export const FIXED_POLL_DEPLOY_CONSTANTS = {
  tallyProcessingStateTreeDepth: 1,
  voteOptionTreeDepth: 2,
  messageBatchSize: 20,
  initialVoiceCreditAmount: 100,
} as const;

export interface PollDeployConfig {
  /** Serialized coordinator MACI public key, e.g. "macipk.XXX" */
  coordinatorPublicKey: string;
  treeDepths: {
    tallyProcessingStateTreeDepth: number;
    voteOptionTreeDepth: number;
    stateTreeDepth: number;
  };
  messageBatchSize: number;
  /** FreeForAllPolicyFactory contract address */
  freeForAllPolicyFactory: Hex;
  /** Stateless FreeForAllChecker contract address (reused across all polls) */
  freeForAllChecker: Hex;
  /** ConstantInitialVoiceCreditProxyFactory contract address */
  constantVoiceCreditProxyFactory: Hex;
  /** Voice credits each voter receives */
  initialVoiceCreditAmount: number;
}

export interface PolicyFactoryPair {
  checker: Hex;
  policy: Hex;
}

export interface PolicyFactories {
  freeForAll: PolicyFactoryPair;
  eas: PolicyFactoryPair;
  zupass: PolicyFactoryPair;
  gitcoinPassport: PolicyFactoryPair;
  semaphore: PolicyFactoryPair;
  anonAadhaar: PolicyFactoryPair;
  erc20Token: PolicyFactoryPair;
  erc20Votes: PolicyFactoryPair;
  token: PolicyFactoryPair;
  merkleProof: PolicyFactoryPair;
  hatsProtocol: PolicyFactoryPair;
}

export interface PolicyInfrastructure {
  easAddress: Hex;
  zupassVerifier: Hex;
  gitcoinDecoder: Hex;
  semaphoreAddress: Hex;
  anonAadhaarVerifier: Hex;
  hatsAddress: Hex;
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Hex;

const ZERO_POLICY_PAIR: PolicyFactoryPair = { checker: ZERO_ADDR, policy: ZERO_ADDR };

export const appConstants: Record<
  (typeof supportedChains)[number]["id"],
  {
    chain: (typeof supportedChains)[number];
    isTestnet: boolean;
    blockTime: number;
    rpcUrl: string;
    /** ZuGovRegistry contract address for this chain. Zero address = not yet deployed. */
    registryAddress: Hex;
    /** Proxy factory contracts per policy type. Zero addresses = not yet deployed. */
    policyFactories: PolicyFactories;
    /** External infrastructure contracts required by parameterized policies. */
    policyInfrastructure: PolicyInfrastructure;
    /** ConstantInitialVoiceCreditProxyFactory address for this chain. Zero address = not yet deployed. */
    constantVoiceCreditProxyFactory: Hex;
    /** The stateless FreeForAllChecker *instance* (reused across all polls) — distinct from
     * policyFactories.freeForAll.checker, which is the CheckerFactory. Zero address = not yet deployed. */
    freeForAllChecker: Hex;
    faucets?: Array<{ name: string; url: string }>;
  }
> = {
  [scrollSepolia.id]: {
    chain: scrollSepolia,
    isTestnet: true,
    blockTime: 3000,
    rpcUrl: "https://sepolia-rpc.scroll.io",
    registryAddress: "0x0000000000000000000000000000000000000000",
    policyFactories: {
      freeForAll: {
        checker: "0x107Cb0A61b86929634442D37200f4c8b0daa1196",
        policy: "0xC203e10a64b6855a215185E16a1f79f87DF0FCF0",
      },
      eas: ZERO_POLICY_PAIR,
      zupass: ZERO_POLICY_PAIR,
      gitcoinPassport: ZERO_POLICY_PAIR,
      semaphore: ZERO_POLICY_PAIR,
      anonAadhaar: ZERO_POLICY_PAIR,
      erc20Token: {
        checker: "0xe7f9C1d5eEf1FbB40358F627701b8488987C1De5",
        policy: "0x5364CE9aF6dED835Cec2E4024AD46Dd5CD364B0d",
      },
      erc20Votes: ZERO_POLICY_PAIR,
      token: ZERO_POLICY_PAIR,
      merkleProof: ZERO_POLICY_PAIR,
      hatsProtocol: ZERO_POLICY_PAIR,
    },
    policyInfrastructure: {
      easAddress: ZERO_ADDR,
      zupassVerifier: ZERO_ADDR,
      gitcoinDecoder: ZERO_ADDR,
      semaphoreAddress: ZERO_ADDR,
      anonAadhaarVerifier: ZERO_ADDR,
      hatsAddress: ZERO_ADDR,
    },
    constantVoiceCreditProxyFactory: ZERO_ADDR,
    freeForAllChecker: ZERO_ADDR,
    faucets: [
      {
        name: "Scroll Sepolia Faucet",
        url: "https://sepolia.scroll.io/faucet",
      },
      {
        name: "Quicknode Faucet",
        url: "https://faucet.quicknode.com/scroll/sepolia",
      },
    ],
  },
  [sepolia.id]: {
    chain: sepolia,
    isTestnet: true,
    blockTime: 12000,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    registryAddress: sepoliaDeployment.registryAddress,
    policyFactories: sepoliaDeployment.policyFactories,
    policyInfrastructure: sepoliaDeployment.policyInfrastructure,
    constantVoiceCreditProxyFactory: sepoliaDeployment.constantVoiceCreditProxyFactory,
    freeForAllChecker: sepoliaDeployment.freeForAllChecker,
    faucets: [
      {
        name: "Google Cloud Web3 Faucet",
        url: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
      },
      {
        name: "Alchemy Sepolia Faucet",
        url: "https://www.alchemy.com/faucets/ethereum-sepolia",
      },
    ],
  },
};
