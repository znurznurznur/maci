import { EMode, EPolicy } from "@maci-protocol/sdk";

import path from "path";

// local file path where we are storing the contract addresses
export const contractAddressesStorePath = path.resolve(__dirname, "..", "..", "deployed-contracts.json");

export const MODE_NAME_TO_ENUM: Record<string, EMode> = {
  qv: EMode.QV,
  "non-qv": EMode.NON_QV,
  full: EMode.FULL,
  ranked: EMode.RANKED,
};

export const POLICY_NAME_TO_ENUM: Record<string, EPolicy> = {
  erc20: EPolicy.ERC20,
  freeForAll: EPolicy.FreeForAll,
  merkleProof: EPolicy.MerkleProof,
  erc20votes: EPolicy.ERC20Votes,
  eas: EPolicy.EAS,
  gitcoinPassport: EPolicy.GitcoinPassport,
  zupass: EPolicy.Zupass,
  semaphore: EPolicy.Semaphore,
  anonAadhar: EPolicy.AnonAadhaar,
  token: EPolicy.Token,
  hats: EPolicy.Hats,
};
