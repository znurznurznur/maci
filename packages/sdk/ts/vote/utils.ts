import { Poll__factory as PollFactory } from "@maci-protocol/contracts/typechain-types";
import { SNARK_FIELD_SIZE } from "@maci-protocol/crypto";
import { PublicKey } from "@maci-protocol/domainobjs";

import type { Signer } from "ethers";

/**
 * Run both format check and size check on a salt value
 * @param salt the salt to validate
 * @returns whether it is valid or not
 */
export const validateSalt = (salt: bigint): boolean => salt < SNARK_FIELD_SIZE;

/**
 * Get the coordinator public key for a poll
 * @param pollAddress - the address of the poll
 * @param signer - the signer to use
 * @returns the coordinator public key
 */
export const getCoordinatorPublicKey = async (pollAddress: string, signer: Signer): Promise<PublicKey> => {
  const pollContract = PollFactory.connect(pollAddress, signer);

  const coordinatorPublicKey = await pollContract.coordinatorPublicKey();

  return new PublicKey([coordinatorPublicKey.x, coordinatorPublicKey.y]);
};

/**
 * Unpacks a 50-bit vote option index into individual vote options
 * @param voteOptionIndex - The packed vote option index (50 bits)
 * @returns Array of 12 vote options (each 4 bits)
 */
export const unpackVoteOptions = (voteOptionIndex: bigint, maxVoteOptions: bigint): number[] => {
  const votes: number[] = [];

  // Extract 4-bit segments from the 50-bit input
  // eslint-disable-next-line no-bitwise
  for (let i = 0; i < maxVoteOptions; i += 1) {
    const shift = i * 4;
    // eslint-disable-next-line no-bitwise
    const mask = BigInt(0xf) << BigInt(shift);
    // eslint-disable-next-line no-bitwise
    const voteOption = Number((voteOptionIndex & mask) >> BigInt(shift));
    votes.push(voteOption);
  }

  return votes;
};

/**
 * Validates that vote options are unique and within valid range
 * @param votes - Array of vote options
 * @param maxVoteOptions - Maximum number of vote options allowed
 * @returns true if all votes are unique and valid
 */
export const validateVoteOptions = (votes: number[], maxVoteOptions: bigint): boolean => {
  const maxOptions = Number(maxVoteOptions);

  const seenNonZero = new Set<number>();
  // Check for uniqueness (non-zero values should be unique)
  // Check each vote option is within valid range
  // eslint-disable-next-line @typescript-eslint/prefer-for-of
  for (let i = 0; i < votes.length; i += 1) {
    if (votes[i] > maxOptions) {
      return false;
    }
    if (votes[i] !== 0) {
      if (seenNonZero.has(votes[i])) {
        return false;
      }
      seenNonZero.add(votes[i]);
    }
  }

  return true;
};
