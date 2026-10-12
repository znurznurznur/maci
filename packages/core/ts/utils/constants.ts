export const STATE_TREE_DEPTH = 10;
export const POLL_STATE_TREE_DEPTH = 10;
export const STATE_TREE_ARITY = 2;
export const STATE_TREE_SUBDEPTH = 2;
export const VOTE_OPTION_TREE_ARITY = 5;
export const MESSAGE_BATCH_SIZE = 20;
export const MAX_RANKED_VOTE_OPTIONS = 12;

/**
 * Supported verification key and voting modes
 */
export enum EMode {
  QV,
  NON_QV,
  FULL,
  RANKED,
}

export enum EPolicy {
  ERC20,
  FreeForAll,
  MerkleProof,
  ERC20Votes,
  EAS,
  GitcoinPassport,
  Zupass,
  Semaphore,
  AnonAadhaar,
  Token,
  Hats,
}
