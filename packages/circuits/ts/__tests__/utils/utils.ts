import { Circomkit, type WitnessTester, type CircomkitConfig } from "circomkit";

import fs from "fs";
import path from "path";

import { MAX_RANKED_VOTE_OPTIONS } from "./constants";

const configFilePath = path.resolve(__dirname, "..", "..", "..", "circomkit.json");
const config = JSON.parse(fs.readFileSync(configFilePath, "utf-8")) as CircomkitConfig;

export const circomkitInstance = new Circomkit({
  ...config,
  verbose: false,
});

/**
 * Convert a string to a bigint
 * @param s - the string to convert
 * @returns the bigint representation of the string
 */
export const str2BigInt = (s: string): bigint => BigInt(parseInt(Buffer.from(s).toString("hex"), 16));

/**
 * Generate a random number within a certain threshold
 * @param upper - the upper bound
 * @returns the random index
 */
export const generateRandomIndex = (upper: number): number => Math.floor(Math.random() * (upper - 1));

export const generateRandomVoteArray = (length = 12): number[] => {
  const votes: number[] = [];
  for (let i = 0; i < length; i += 1) {
    const randomIndex = generateRandomIndex(length);
    let found = false;
    for (let j = 0; j < i; j += 1) {
      if (votes[j] === randomIndex) {
        found = true;
        break;
      }
    }
    votes.push(found ? 0 : randomIndex);
  }
  return votes;
};

// @note thanks https://github.com/Rate-Limiting-Nullifier/circom-rln/blob/main/test/utils.ts
// for the code below (modified version)
/**
 * Get a signal from the circuit
 * @param circuit - the circuit object
 * @param witness - the witness
 * @param name - the name of the signal
 * @returns the signal value
 */
export const getSignal = async (tester: WitnessTester, witness: bigint[], name: string): Promise<bigint> => {
  const prefix = "main";
  // E.g. the full name of the signal "root" is "main.root"
  // You can look up the signal names using `circuit.getDecoratedOutput(witness))`
  const signalFullName = `${prefix}.${name}`;

  const out = await tester.readWitness(witness, [signalFullName]);
  return BigInt(out[signalFullName]);
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
