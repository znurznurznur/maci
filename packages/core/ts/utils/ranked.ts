import { MAX_RANKED_VOTE_OPTIONS } from "./constants";

/**
 * Unpacks vote options from a packed bigint value
 * @param packed The packed bigint value containing the votes
 * @param numVotes The number of votes to unpack (default: 12, max: 12)
 * @returns Array of numbers, each between 0-12
 */
export const unpackVoteOptions = (packed: bigint, numVotes = 12): bigint[] => {
  if (numVotes > 12 || numVotes < 1) {
    throw new Error("Number of votes must be between 1 and 12");
  }
  const votes: bigint[] = [];

  for (let i = 0; i < numVotes; i += 1) {
    // eslint-disable-next-line no-bitwise
    votes.push((packed >> BigInt(i * 4)) & 15n);
  }
  return votes;
};

export const packRankedVotesTo50Bits = (votes: number[]): bigint => {
  if (votes.length > MAX_RANKED_VOTE_OPTIONS) {
    throw new Error("Expected at most 12 votes");
  }

  let result = 0n;

  for (let i = 0; i < votes.length; i += 1) {
    const v = BigInt(votes[i]);

    if (v < 0 || v > votes.length) {
      throw new Error(`Vote ${i} out of 4-bit range`);
    }

    const vBigInt = BigInt(v);
    const shift = BigInt(i * 4);
    // eslint-disable-next-line no-bitwise
    result |= vBigInt << shift;
  }

  return result; // BigInt (fits in 50 bits)
};
