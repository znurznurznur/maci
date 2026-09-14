import { Contract, type ContractRunner } from "ethers";

import {
  MACI_ABI,
  MACI_BYTECODE,
  POLL_ABI,
  BASE_POLICY_ABI,
  BASE_CHECKER_ABI,
  FREE_FOR_ALL_POLICY_ABI,
  FREE_FOR_ALL_POLICY_FACTORY_ABI,
  CONSTANT_VOICE_CREDIT_PROXY_FACTORY_ABI,
} from "./generated/abis";

// Browser-safe replacement for @extended-maci/contracts/typechain-types (see vite.config.ts).
// ABIs are copied from the real compiled artifacts by packages/contracts/scripts/syncFrontendAbis.ts
// rather than hand-typed, so they can't drift from what's actually deployed. Only MACI needs
// bytecode — everything else here is only ever `.connect()`-ed to an already-deployed contract.

export const MACI__factory = {
  abi: MACI_ABI,
  bytecode: MACI_BYTECODE,
  connect: (address: string, runner: ContractRunner | null) => new Contract(address, MACI_ABI, runner),
};

export const Poll__factory = {
  connect: (address: string, runner: ContractRunner | null) => new Contract(address, POLL_ABI, runner),
};

export const BasePolicy__factory = {
  connect: (address: string, runner: ContractRunner | null) => new Contract(address, BASE_POLICY_ABI, runner),
};

export const BaseChecker__factory = {
  connect: (address: string, runner: ContractRunner | null) => new Contract(address, BASE_CHECKER_ABI, runner),
};

export const FreeForAllPolicy__factory = {
  connect: (address: string, runner: ContractRunner | null) => new Contract(address, FREE_FOR_ALL_POLICY_ABI, runner),
};

export const FreeForAllPolicyFactory__factory = {
  connect: (address: string, runner: ContractRunner | null) =>
    new Contract(address, FREE_FOR_ALL_POLICY_FACTORY_ABI, runner),
};

export const ConstantVoiceCreditProxyFactory__factory = {
  connect: (address: string, runner: ContractRunner | null) =>
    new Contract(address, CONSTANT_VOICE_CREDIT_PROXY_FACTORY_ABI, runner),
};
