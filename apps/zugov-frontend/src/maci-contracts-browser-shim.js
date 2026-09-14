import { IncrementalQuinTree, hash2 } from "@extended-maci/crypto";
import { Ballot } from "@extended-maci/domainobjs";

// Browser-safe replacement for @extended-maci/contracts.
// Only provides what the browser SDK actually needs at runtime.
// Enums and server-side utilities are intentionally omitted.

// contractExists and currentBlockTimestamp — inlined to avoid contracts/ts/utils.js
// which has a dynamic require("hardhat")
export const contractExists = async (provider, address) => {
  const code = await provider.getCode(address);
  return code.length > 2;
};

export const currentBlockTimestamp = async (provider) => {
  const blockNum = await provider.getBlockNumber();
  const block = await provider.getBlock(blockNum);
  return Number(block?.timestamp);
};

// generateEmptyBallotRoots — inlined from contracts/ts/generateEmptyBallotRoots.ts to avoid
// pulling in @extended-maci/core's full barrel export just for the STATE_TREE_ARITY constant.
const STATE_TREE_ARITY = 2;

export const generateEmptyBallotRoots = (stateTreeDepth) => {
  const roots = [];

  for (let i = 0; i < 5; i += 1) {
    const ballot = new Ballot(0, i + 1);
    const ballotTree = new IncrementalQuinTree(stateTreeDepth, ballot.hash(), STATE_TREE_ARITY, hash2);

    roots.push(ballotTree.root);
  }

  return roots;
};

// @extended-maci/sdk's policy.ts reads this enum at module-evaluation time (a top-level object
// literal keyed by it), not lazily — omitting it isn't safe once the bare sdk entry point is
// actually loaded in the browser (see vite.config.ts's optimizeDeps comment). Values copied
// verbatim from packages/contracts/tasks/helpers/types.ts's EPolicies enum.
export const EPolicies = {
  FreeForAll: "@excubiae/contracts/contracts/extensions/freeForAll/FreeForAllPolicy.sol:FreeForAllPolicy",
  Token: "@excubiae/contracts/contracts/extensions/token/TokenPolicy.sol:TokenPolicy",
  EAS: "@excubiae/contracts/contracts/extensions/eas/EASPolicy.sol:EASPolicy",
  GitcoinPassport: "@excubiae/contracts/contracts/extensions/gitcoin/GitcoinPassportPolicy.sol:GitcoinPassportPolicy",
  Hats: "@excubiae/contracts/contracts/extensions/hats/HatsPolicy.sol:HatsPolicy",
  Zupass: "@excubiae/contracts/contracts/extensions/zupass/ZupassPolicy.sol:ZupassPolicy",
  Semaphore: "@excubiae/contracts/contracts/extensions/semaphore/SemaphorePolicy.sol:SemaphorePolicy",
  MerkleProof: "@excubiae/contracts/contracts/extensions/merkle/MerkleProofPolicy.sol:MerkleProofPolicy",
  AnonAadhaar: "@excubiae/contracts/contracts/extensions/anonAadhaar/AnonAadhaarPolicy.sol:AnonAadhaarPolicy",
  ERC20Votes: "@excubiae/contracts/contracts/extensions/erc20votes/ERC20VotesPolicy.sol:ERC20VotesPolicy",
  ERC20: "@excubiae/contracts/contracts/extensions/erc20/ERC20Policy.sol:ERC20Policy",
};
