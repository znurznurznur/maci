import { type WitnessTester } from "circomkit";

import { circomkitInstance, packRankedVotesTo50Bits } from "./utils/utils";

describe("UnpackRankedVoteOption circuit", () => {
  let circuit: WitnessTester<["in"], ["out", "isUniqueAndValid"]>;

  before(async () => {
    circuit = await circomkitInstance.WitnessTester("unpackRankedVoteOptions", {
      file: "./utils/ranked/UnpackRankedVoteOption",
      template: "UnpackRankedVoteOptionAndCheckUniqueness",
    });
  });

  it("should correctly output votes", async () => {
    const votes = [3, 4, 7, 9, 1, 2, 5, 12, 11, 8, 10, 6];
    const voteOptionIndex = packRankedVotesTo50Bits(votes);
    const circuitInputs = { in: voteOptionIndex, voteOptions: 12 };

    await circuit.expectPass(circuitInputs, { out: votes, isUniqueAndValid: 1 });
  });

  it("should correctly output votes when a vote option is greater than `voteOptions`", async () => {
    const votes = [3, 13, 7, 9, 1, 2, 5, 12, 11, 8, 10, 6];
    let result = 0n;

    for (let i = 0; i < votes.length; i += 1) {
      const v = BigInt(votes[i]);

      const shift = BigInt(i * 4);
      // eslint-disable-next-line no-bitwise
      result |= v << shift;
    }
    const voteOptionIndex = result;
    const circuitInputs = { in: voteOptionIndex, voteOptions: 12 };

    await circuit.expectPass(circuitInputs, { out: votes, isUniqueAndValid: 0 });
  });

  it("should correctly output votes when a vote option is 0", async () => {
    const votes = [3, 0, 7, 9, 1, 2, 5, 12, 11, 8, 10, 6];
    const voteOptionIndex = packRankedVotesTo50Bits(votes);
    const circuitInputs = { in: voteOptionIndex, voteOptions: 12 };

    await circuit.expectPass(circuitInputs, { out: votes, isUniqueAndValid: 1 });
  });

  it("should correctly output votes when there is duplicate rankings", async () => {
    const votes = [3, 1, 7, 9, 1, 2, 5, 12, 11, 8, 10, 6];
    const voteOptionIndex = packRankedVotesTo50Bits(votes);
    const circuitInputs = { in: voteOptionIndex, voteOptions: 12 };

    await circuit.expectPass(circuitInputs, { out: votes, isUniqueAndValid: 0 });
  });

  it("should correctly output votes, when voteOptions less than `MAX_RANKED_VOTE_OPTIONS`", async () => {
    circuit = await circomkitInstance.WitnessTester("unpackRankedVoteOptions", {
      file: "./utils/ranked/UnpackRankedVoteOption",
      template: "UnpackRankedVoteOptionAndCheckUniqueness",
    });
    const votes = [3, 4, 7, 9, 1, 2, 5, 8, 6];
    const voteOptionIndex = packRankedVotesTo50Bits(votes);
    const circuitInputs = { in: voteOptionIndex, voteOptions: 9 };

    await circuit.expectPass(circuitInputs, { out: votes, isUniqueAndValid: 1 });
  });
});
