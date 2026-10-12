import { VOTE_OPTION_TREE_ARITY, packRankedVotesTo50Bits } from "@maci-protocol/core";
import { MAX_RANKED_VOTE_OPTIONS } from "@maci-protocol/core/build/ts/utils/constants";
import { generateRandomSalt } from "@maci-protocol/crypto";
import { Keypair } from "@maci-protocol/domainobjs";
import {
  generateVote,
  getDefaultSigner,
  signup,
  mergeSignups,
  verify,
  setVerifyingKeys,
  EMode,
  EPolicy,
  proveOnChain,
  publish,
  deployPoll,
  generateProofs,
  timeTravel,
  isArm,
  deployMaci,
  deployFreeForAllSignUpPolicy,
  deployConstantInitialVoiceCreditProxy,
  type IGenerateProofsArgs,
  type IMaciContracts,
  joinPoll,
  deployConstantInitialVoiceCreditProxyFactory,
} from "@maci-protocol/sdk";
import { expect } from "chai";

import type { Signer } from "ethers";

import {
  DEFAULT_INITIAL_VOICE_CREDITS,
  DEFAULT_SG_DATA,
  deployPollArgs,
  coordinatorPrivateKey,
  pollDuration,
  proveOnChainArgs,
  verifyArgs,
  mergeSignupsArgs,
  testProofsDirPath,
  testRapidsnarkPath,
  testTallyFilePath,
  deployArgs,
  testProcessMessagesRankedWitnessPath,
  testProcessMessagesRankedWitnessDatPath,
  testTallyVotesRankedWitnessPath,
  testTallyVotesRankedWitnessDatPath,
  testProcessMessagesRankedWasmPath,
  testTallyVotesRankedWasmPath,
  testProcessMessageRankedZkeyPath,
  testTallyVotesRankedZkeyPath,
  coordinatorKeypair,
  verifyingKeysArgs,
  testPollJoiningZkeyPath,
  testPollJoiningWasmPath,
  testPollJoiningWitnessPath,
  DEFAULT_IVCP_DATA,
} from "../constants";
import { clean, getBackupFilenames, getPollStartTimestamp, relayTestMessages } from "../utils";

/**
 Test scenarios:
    1 signup, 1 message
    1 signup, 1 relayed message
    1 signup, 2 valid messages
    1 signup, 2 valid and 2 invalid messages
    4 signups, 8 messages, 16 relayed messages
    30 signups (31 ballots), 21 messages
    30 signups, 30 invalid and 1 valid messages
 */
describe("e2e tests with ranked credits voting", function test() {
  const useWasm = isArm();
  this.timeout(900000);

  let maciAddresses: IMaciContracts;
  let initialVoiceCreditProxyContractAddress: string;
  let signer: Signer;
  const votes1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const votes2 = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1];
  const votes3 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];
  const votes4 = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
  const voteWeight1 = 10;
  const voteWeight2 = 20;
  const voteWeight3 = 30;
  const voteWeight4 = 40;

  const generateProofsArgs: Omit<IGenerateProofsArgs, "maciAddress" | "signer"> = {
    outputDir: testProofsDirPath,
    tallyFile: testTallyFilePath,
    voteTallyZkey: testTallyVotesRankedZkeyPath,
    messageProcessorZkey: testProcessMessageRankedZkeyPath,
    pollId: 0n,
    rapidsnark: testRapidsnarkPath,
    messageProcessorWitnessGenerator: testProcessMessagesRankedWitnessPath,
    messageProcessorWitnessDatFile: testProcessMessagesRankedWitnessDatPath,
    voteTallyWitnessGenerator: testTallyVotesRankedWitnessPath,
    voteTallyWitnessDatFile: testTallyVotesRankedWitnessDatPath,
    coordinatorPrivateKey,
    messageProcessorWasm: testProcessMessagesRankedWasmPath,
    voteTallyWasm: testTallyVotesRankedWasmPath,
    useWasm,
    mode: EMode.RANKED,
  };

  const prepareTest = async () => {
    const [signupPolicy, , signupPolicyFactory, signupCheckerFactory] = await deployFreeForAllSignUpPolicy(
      {},
      signer,
      true,
    );
    const signupPolicyContractAddress = await signupPolicy.getAddress();

    const [pollPolicy] = await deployFreeForAllSignUpPolicy(
      { policy: signupPolicyFactory, checker: signupCheckerFactory },
      signer,
      true,
    );
    const pollPolicyContractAddress = await pollPolicy.getAddress();

    // deploy the smart contracts
    const maciContractsAddresses = await deployMaci({
      ...deployArgs,
      signer,
      signupPolicyAddress: signupPolicyContractAddress,
    });

    // we set the verifying keys
    const { verifyingKeysRegistryContractAddress } = maciContractsAddresses;
    await setVerifyingKeys({
      ...(await verifyingKeysArgs(signer, [EMode.RANKED])),
      verifyingKeysRegistryAddress: verifyingKeysRegistryContractAddress,
    });

    const startDate = await getPollStartTimestamp(signer);

    // deploy a poll contract
    await deployPoll({
      ...deployPollArgs,
      signer,
      pollStartTimestamp: startDate,
      pollEndTimestamp: startDate + pollDuration,
      relayers: [await signer.getAddress()],
      maciAddress: maciContractsAddresses.maciContractAddress,
      policyContractAddress: pollPolicyContractAddress,
      initialVoiceCreditProxyContractAddress,
      mode: EMode.RANKED,
      voteOptions: MAX_RANKED_VOTE_OPTIONS,
      policy: EPolicy.FreeForAll,
      name: "test",
      metadata: "",
      options: [],
      optionInfo: [],
    });

    return maciContractsAddresses;
  };

  // before all tests we deploy the verifying keys registry contract and set the verifying keys
  before(async () => {
    signer = await getDefaultSigner();

    const constantInitialVoiceCreditProxyFactory = await deployConstantInitialVoiceCreditProxyFactory(signer, true);
    const initialVoiceCreditProxy = await deployConstantInitialVoiceCreditProxy(
      { amount: DEFAULT_INITIAL_VOICE_CREDITS },
      constantInitialVoiceCreditProxyFactory,
      signer,
    );
    initialVoiceCreditProxyContractAddress = await initialVoiceCreditProxy.getAddress();
  });

  describe("1 signup, 1 message", () => {
    after(async () => {
      await clean();
    });

    const user = new Keypair();
    const votes = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

    before(async () => {
      // deploy the smart contracts
      maciAddresses = await prepareTest();
    });

    it("should signup one user", async () => {
      await signup({
        maciAddress: maciAddresses.maciContractAddress,
        maciPublicKey: user.publicKey.serialize(),
        sgData: DEFAULT_SG_DATA,
        signer,
      });
    });

    it("should join one user", async () => {
      await joinPoll({
        maciAddress: maciAddresses.maciContractAddress,
        privateKey: user.privateKey.serialize(),
        pollId: 0n,
        pollJoiningZkey: testPollJoiningZkeyPath,
        useWasm,
        pollJoiningWasm: testPollJoiningWasmPath,
        pollWitnessGenerator: testPollJoiningWitnessPath,
        rapidsnark: testRapidsnarkPath,
        sgDataArg: DEFAULT_SG_DATA,
        ivcpDataArg: DEFAULT_IVCP_DATA,
        signer,
      });
    });

    it("should publish one message", async () => {
      await publish({
        publicKey: user.publicKey.serialize(),
        stateIndex: 1n,
        voteOptionIndex: packRankedVotesTo50Bits(votes),
        nonce: 1n,
        pollId: 0n,
        newVoteWeight: BigInt(DEFAULT_INITIAL_VOICE_CREDITS),
        maciAddress: maciAddresses.maciContractAddress,
        salt: generateRandomSalt(),
        privateKey: user.privateKey.serialize(),
        signer,
        isRanked: true,
      });
    });

    it("should generate zk-SNARK proofs and verify them", async () => {
      await timeTravel({ seconds: pollDuration, signer });
      await mergeSignups({ ...mergeSignupsArgs, maciAddress: maciAddresses.maciContractAddress, signer });
      const { tallyData: tallyFileData } = await generateProofs({
        ...generateProofsArgs,
        signer,
        maciAddress: maciAddresses.maciContractAddress,
        mode: EMode.RANKED,
      });
      await proveOnChain({ ...proveOnChainArgs, maciAddress: maciAddresses.maciContractAddress, signer });
      await verify({
        ...(await verifyArgs(signer)),
        tallyData: tallyFileData,
        maciAddress: tallyFileData.maci,
      });

      expect(tallyFileData.totalSpentVoiceCredits.spent.toString()).to.eq(DEFAULT_INITIAL_VOICE_CREDITS.toString());

      tallyFileData.results.tally.forEach((result, index) => {
        expect(result.toString()).to.eq((votes[index] * DEFAULT_INITIAL_VOICE_CREDITS).toString());
      });
    });
  });

  describe("1 signup, 1 relayed message", () => {
    after(async () => {
      await clean();
    });

    const user = new Keypair();

    before(async () => {
      // deploy the smart contracts
      maciAddresses = await prepareTest();
    });

    it("should signup one user", async () => {
      await signup({
        maciAddress: maciAddresses.maciContractAddress,
        maciPublicKey: user.publicKey.serialize(),
        sgData: DEFAULT_SG_DATA,
        signer,
      });
    });

    it("should join one user", async () => {
      await joinPoll({
        maciAddress: maciAddresses.maciContractAddress,
        privateKey: user.privateKey.serialize(),
        pollId: 0n,
        pollJoiningZkey: testPollJoiningZkeyPath,
        useWasm,
        pollJoiningWasm: testPollJoiningWasmPath,
        pollWitnessGenerator: testPollJoiningWitnessPath,
        rapidsnark: testRapidsnarkPath,
        sgDataArg: DEFAULT_SG_DATA,
        ivcpDataArg: DEFAULT_IVCP_DATA,
        signer,
      });
    });

    it("should relay one message", async () => {
      const { message, ephemeralKeypair } = generateVote({
        isRanked: true,
        pollId: 0n,
        voteOptionIndex: packRankedVotesTo50Bits(votes1),
        salt: generateRandomSalt(),
        nonce: 1n,
        privateKey: user.privateKey,
        stateIndex: 1n,
        voteWeight: BigInt(DEFAULT_INITIAL_VOICE_CREDITS),
        coordinatorPublicKey: coordinatorKeypair.publicKey,
        maxVoteOption: BigInt(VOTE_OPTION_TREE_ARITY ** deployPollArgs.voteOptionTreeDepth),
        newPublicKey: user.publicKey,
      });

      const messages = [
        {
          maciAddress: maciAddresses.maciContractAddress,
          poll: 0,
          data: message.data.map(String),
          publicKey: ephemeralKeypair.publicKey.asArray().map(String),
          hash: message.hash(ephemeralKeypair.publicKey).toString(),
        },
      ];

      await relayTestMessages({ messages, signer, pollId: 0, maciAddress: maciAddresses.maciContractAddress });
    });

    it("should generate zk-SNARK proofs and verify them", async () => {
      const ipfsMessageBackupFiles = await getBackupFilenames();
      await timeTravel({ seconds: pollDuration, signer });
      await mergeSignups({ ...mergeSignupsArgs, maciAddress: maciAddresses.maciContractAddress, signer });
      const { tallyData: tallyFileData } = await generateProofs({
        ...generateProofsArgs,
        signer,
        maciAddress: maciAddresses.maciContractAddress,
        ipfsMessageBackupFiles,
        mode: EMode.RANKED,
      });
      await proveOnChain({ ...proveOnChainArgs, maciAddress: maciAddresses.maciContractAddress, signer });
      await verify({
        ...(await verifyArgs(signer)),
        tallyData: tallyFileData,
        maciAddress: tallyFileData.maci,
      });

      expect(tallyFileData.totalSpentVoiceCredits.spent.toString()).to.eq(DEFAULT_INITIAL_VOICE_CREDITS.toString());

      tallyFileData.results.tally.forEach((result, index) => {
        expect(result.toString()).to.eq((votes1[index] * DEFAULT_INITIAL_VOICE_CREDITS).toString());
      });
    });
  });

  describe("1 signup, 1 valid messages", () => {
    after(async () => {
      await clean();
    });

    const user = new Keypair();

    before(async () => {
      // deploy the smart contracts
      maciAddresses = await prepareTest();
    });

    it("should signup one user", async () => {
      await signup({
        maciAddress: maciAddresses.maciContractAddress,
        maciPublicKey: user.publicKey.serialize(),
        sgData: DEFAULT_SG_DATA,
        signer,
      });
    });

    it("should join one user", async () => {
      await joinPoll({
        maciAddress: maciAddresses.maciContractAddress,
        privateKey: user.privateKey.serialize(),
        pollId: 0n,
        pollJoiningZkey: testPollJoiningZkeyPath,
        useWasm,
        pollJoiningWasm: testPollJoiningWasmPath,
        pollWitnessGenerator: testPollJoiningWitnessPath,
        rapidsnark: testRapidsnarkPath,
        sgDataArg: DEFAULT_SG_DATA,
        ivcpDataArg: DEFAULT_IVCP_DATA,
        signer,
      });
    });

    it("should publish two messages", async () => {
      await publish({
        publicKey: user.publicKey.serialize(),
        stateIndex: 1n,
        voteOptionIndex: packRankedVotesTo50Bits(votes1),
        nonce: 1n,
        pollId: 0n,
        newVoteWeight: BigInt(DEFAULT_INITIAL_VOICE_CREDITS),
        maciAddress: maciAddresses.maciContractAddress,
        salt: generateRandomSalt(),
        privateKey: user.privateKey.serialize(),
        signer,
        isRanked: true,
      });

      await publish({
        publicKey: user.publicKey.serialize(),
        stateIndex: 1n,
        voteOptionIndex: packRankedVotesTo50Bits(votes2),
        nonce: 1n,
        pollId: 0n,
        newVoteWeight: BigInt(DEFAULT_INITIAL_VOICE_CREDITS),
        maciAddress: maciAddresses.maciContractAddress,
        salt: generateRandomSalt(),
        privateKey: user.privateKey.serialize(),
        signer,
        isRanked: true,
      });
    });

    it("should generate zk-SNARK proofs and verify them", async () => {
      await timeTravel({ seconds: pollDuration, signer });
      await mergeSignups({ ...mergeSignupsArgs, maciAddress: maciAddresses.maciContractAddress, signer });
      const { tallyData: tallyFileData } = await generateProofs({
        ...generateProofsArgs,
        signer,
        maciAddress: maciAddresses.maciContractAddress,
        mode: EMode.RANKED,
      });
      await proveOnChain({ ...proveOnChainArgs, maciAddress: maciAddresses.maciContractAddress, signer });
      await verify({
        ...(await verifyArgs(signer)),
        tallyData: tallyFileData,
        maciAddress: tallyFileData.maci,
      });

      expect(tallyFileData.totalSpentVoiceCredits.spent.toString()).to.eq(DEFAULT_INITIAL_VOICE_CREDITS.toString());

      tallyFileData.results.tally.forEach((result, index) => {
        expect(result.toString()).to.eq((votes2[index] * DEFAULT_INITIAL_VOICE_CREDITS).toString());
      });
    });
  });

  describe("1 signup, 2 valid and 2 invalid message", () => {
    after(async () => {
      await clean();
    });

    const user = new Keypair();

    before(async () => {
      // deploy the smart contracts
      maciAddresses = await prepareTest();
    });

    it("should signup one user", async () => {
      await signup({
        maciAddress: maciAddresses.maciContractAddress,
        maciPublicKey: user.publicKey.serialize(),
        sgData: DEFAULT_SG_DATA,
        signer,
      });
    });

    it("should join one user", async () => {
      await joinPoll({
        maciAddress: maciAddresses.maciContractAddress,
        privateKey: user.privateKey.serialize(),
        pollId: 0n,
        pollJoiningZkey: testPollJoiningZkeyPath,
        useWasm,
        pollJoiningWasm: testPollJoiningWasmPath,
        pollWitnessGenerator: testPollJoiningWitnessPath,
        rapidsnark: testRapidsnarkPath,
        sgDataArg: DEFAULT_SG_DATA,
        ivcpDataArg: DEFAULT_IVCP_DATA,
        signer,
      });
    });

    it("should publish two valid and two invalid messages", async () => {
      await publish({
        publicKey: user.publicKey.serialize(),
        stateIndex: 1n,
        voteOptionIndex: packRankedVotesTo50Bits(votes1),
        nonce: 1n,
        pollId: 0n,
        newVoteWeight: BigInt(voteWeight1),
        maciAddress: maciAddresses.maciContractAddress,
        salt: generateRandomSalt(),
        privateKey: user.privateKey.serialize(),
        signer,
        isRanked: true,
      });

      await publish({
        publicKey: user.publicKey.serialize(),
        stateIndex: 1n,
        voteOptionIndex: packRankedVotesTo50Bits(votes2),
        nonce: 1n,
        pollId: 0n,
        newVoteWeight: BigInt(voteWeight2),
        maciAddress: maciAddresses.maciContractAddress,
        salt: generateRandomSalt(),
        privateKey: user.privateKey.serialize(),
        signer,
        isRanked: true,
      });

      await publish({
        publicKey: user.publicKey.serialize(),
        stateIndex: 2n,
        voteOptionIndex: packRankedVotesTo50Bits(votes3),
        nonce: 1n,
        pollId: 0n,
        newVoteWeight: BigInt(voteWeight3),
        maciAddress: maciAddresses.maciContractAddress,
        salt: generateRandomSalt(),
        privateKey: user.privateKey.serialize(),
        signer,
        isRanked: true,
      });

      await publish({
        publicKey: user.publicKey.serialize(),
        stateIndex: 2n,
        voteOptionIndex: packRankedVotesTo50Bits(votes4),
        nonce: 1n,
        pollId: 0n,
        newVoteWeight: BigInt(voteWeight4),
        maciAddress: maciAddresses.maciContractAddress,
        salt: generateRandomSalt(),
        privateKey: user.privateKey.serialize(),
        signer,
        isRanked: true,
      });
    });

    it("should generate zk-SNARK proofs and verify them", async () => {
      await timeTravel({ seconds: pollDuration, signer });
      await mergeSignups({ ...mergeSignupsArgs, maciAddress: maciAddresses.maciContractAddress, signer });
      const { tallyData: tallyFileData } = await generateProofs({
        ...generateProofsArgs,
        signer,
        maciAddress: maciAddresses.maciContractAddress,
        mode: EMode.RANKED,
      });
      await proveOnChain({ ...proveOnChainArgs, maciAddress: maciAddresses.maciContractAddress, signer });
      await verify({
        ...(await verifyArgs(signer)),
        tallyData: tallyFileData,
        maciAddress: tallyFileData.maci,
      });

      expect(tallyFileData.totalSpentVoiceCredits.spent.toString()).to.eq(voteWeight2.toString());

      tallyFileData.results.tally.forEach((result, index) => {
        expect(result.toString()).to.eq((votes2[index] * voteWeight2).toString());
      });
    });
  });

  describe("4 signups, 8 messages, 16 relayed messages", () => {
    after(async () => {
      await clean();
    });

    const users = [new Keypair(), new Keypair(), new Keypair(), new Keypair()];

    before(async () => {
      // deploy the smart contracts
      maciAddresses = await prepareTest();
    });

    it("should signup four users", async () => {
      // eslint-disable-next-line @typescript-eslint/prefer-for-of
      for (let i = 0; i < users.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await signup({
          maciAddress: maciAddresses.maciContractAddress,
          maciPublicKey: users[i].publicKey.serialize(),
          sgData: DEFAULT_SG_DATA,
          signer,
        });
      }
    });

    it("should join four users", async () => {
      // eslint-disable-next-line @typescript-eslint/prefer-for-of
      for (let i = 0; i < users.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await joinPoll({
          maciAddress: maciAddresses.maciContractAddress,
          privateKey: users[i].privateKey.serialize(),
          pollId: 0n,
          pollJoiningZkey: testPollJoiningZkeyPath,
          useWasm,
          pollJoiningWasm: testPollJoiningWasmPath,
          pollWitnessGenerator: testPollJoiningWitnessPath,
          rapidsnark: testRapidsnarkPath,
          sgDataArg: DEFAULT_SG_DATA,
          ivcpDataArg: DEFAULT_IVCP_DATA,
          signer,
        });
      }
    });

    it("should publish eight messages", async () => {
      await publish({
        publicKey: users[0].publicKey.serialize(),
        stateIndex: 1n,
        voteOptionIndex: packRankedVotesTo50Bits(votes1),
        nonce: 1n,
        pollId: 0n,
        newVoteWeight: BigInt(voteWeight1),
        maciAddress: maciAddresses.maciContractAddress,
        salt: generateRandomSalt(),
        privateKey: users[0].privateKey.serialize(),
        signer,
        isRanked: true,
      });

      await publish({
        publicKey: users[0].publicKey.serialize(),
        stateIndex: 1n,
        voteOptionIndex: packRankedVotesTo50Bits(votes2),
        nonce: 2n,
        pollId: 0n,
        newVoteWeight: BigInt(voteWeight2),
        maciAddress: maciAddresses.maciContractAddress,
        salt: generateRandomSalt(),
        privateKey: users[0].privateKey.serialize(),
        signer,
        isRanked: true,
      });

      await publish({
        publicKey: users[0].publicKey.serialize(),
        stateIndex: 1n,
        voteOptionIndex: packRankedVotesTo50Bits(votes3),
        nonce: 2n,
        pollId: 0n,
        newVoteWeight: BigInt(voteWeight3),
        maciAddress: maciAddresses.maciContractAddress,
        salt: generateRandomSalt(),
        privateKey: users[0].privateKey.serialize(),
        signer,
        isRanked: true,
      });

      await publish({
        publicKey: users[1].publicKey.serialize(),
        stateIndex: 2n,
        voteOptionIndex: packRankedVotesTo50Bits(votes1),
        nonce: 1n,
        pollId: 0n,
        newVoteWeight: BigInt(voteWeight1),
        maciAddress: maciAddresses.maciContractAddress,
        salt: generateRandomSalt(),
        privateKey: users[1].privateKey.serialize(),
        signer,
        isRanked: true,
      });

      await publish({
        publicKey: users[2].publicKey.serialize(),
        stateIndex: 3n,
        voteOptionIndex: packRankedVotesTo50Bits(votes1),
        nonce: 1n,
        pollId: 0n,
        newVoteWeight: BigInt(voteWeight1),
        maciAddress: maciAddresses.maciContractAddress,
        salt: generateRandomSalt(),
        privateKey: users[2].privateKey.serialize(),
        signer,
        isRanked: true,
      });

      await publish({
        publicKey: users[3].publicKey.serialize(),
        stateIndex: 4n,
        voteOptionIndex: packRankedVotesTo50Bits(votes1),
        nonce: 1n,
        pollId: 0n,
        newVoteWeight: BigInt(voteWeight1),
        maciAddress: maciAddresses.maciContractAddress,
        salt: generateRandomSalt(),
        privateKey: users[3].privateKey.serialize(),
        signer,
        isRanked: true,
      });

      await publish({
        publicKey: users[3].publicKey.serialize(),
        stateIndex: 4n,
        voteOptionIndex: packRankedVotesTo50Bits(votes2),
        nonce: 2n,
        pollId: 0n,
        newVoteWeight: BigInt(voteWeight2),
        maciAddress: maciAddresses.maciContractAddress,
        salt: generateRandomSalt(),
        privateKey: users[3].privateKey.serialize(),
        signer,
        isRanked: true,
      });

      await publish({
        publicKey: users[3].publicKey.serialize(),
        stateIndex: 4n,
        voteOptionIndex: packRankedVotesTo50Bits(votes3),
        nonce: 3n,
        pollId: 0n,
        newVoteWeight: BigInt(voteWeight3),
        maciAddress: maciAddresses.maciContractAddress,
        salt: generateRandomSalt(),
        privateKey: users[3].privateKey.serialize(),
        signer,
        isRanked: true,
      });
    });

    it("should relay sixteen messages", async () => {
      const votes = [
        {
          pollId: 0n,
          voteOptionIndex: packRankedVotesTo50Bits(votes4),
          salt: generateRandomSalt(),
          nonce: 2n,
          privateKey: users[0].privateKey,
          stateIndex: 1n,
          voteWeight: BigInt(voteWeight4),
          coordinatorPublicKey: coordinatorKeypair.publicKey,
          maxVoteOption: BigInt(MAX_RANKED_VOTE_OPTIONS),
          newPublicKey: users[0].publicKey,
        },
        {
          pollId: 0n,
          voteOptionIndex: packRankedVotesTo50Bits(votes1),
          salt: generateRandomSalt(),
          nonce: 2n,
          privateKey: users[0].privateKey,
          stateIndex: 1n,
          voteWeight: BigInt(voteWeight1),
          coordinatorPublicKey: coordinatorKeypair.publicKey,
          maxVoteOption: BigInt(MAX_RANKED_VOTE_OPTIONS),
          newPublicKey: users[0].publicKey,
        },
        {
          pollId: 0n,
          voteOptionIndex: packRankedVotesTo50Bits(votes2),
          salt: generateRandomSalt(),
          nonce: 1n,
          privateKey: users[0].privateKey,
          stateIndex: 1n,
          voteWeight: BigInt(voteWeight2),
          coordinatorPublicKey: coordinatorKeypair.publicKey,
          maxVoteOption: BigInt(MAX_RANKED_VOTE_OPTIONS),
          newPublicKey: users[0].publicKey,
        },
        {
          pollId: 0n,
          voteOptionIndex: packRankedVotesTo50Bits(votes2),
          salt: generateRandomSalt(),
          nonce: 1n,
          privateKey: users[1].privateKey,
          stateIndex: 2n,
          voteWeight: BigInt(voteWeight2),
          coordinatorPublicKey: coordinatorKeypair.publicKey,
          maxVoteOption: BigInt(MAX_RANKED_VOTE_OPTIONS),
          newPublicKey: users[1].publicKey,
        },
        {
          pollId: 0n,
          voteOptionIndex: packRankedVotesTo50Bits(votes3),
          salt: generateRandomSalt(),
          nonce: 1n,
          privateKey: users[2].privateKey,
          stateIndex: 3n,
          voteWeight: BigInt(voteWeight3),
          coordinatorPublicKey: coordinatorKeypair.publicKey,
          maxVoteOption: BigInt(MAX_RANKED_VOTE_OPTIONS),
          newPublicKey: users[2].publicKey,
        },
        {
          pollId: 0n,
          voteOptionIndex: packRankedVotesTo50Bits(votes4),
          salt: generateRandomSalt(),
          nonce: 3n,
          privateKey: users[3].privateKey,
          stateIndex: 4n,
          voteWeight: BigInt(voteWeight4),
          coordinatorPublicKey: coordinatorKeypair.publicKey,
          maxVoteOption: BigInt(MAX_RANKED_VOTE_OPTIONS),
          newPublicKey: users[3].publicKey,
        },
        {
          pollId: 0n,
          voteOptionIndex: packRankedVotesTo50Bits(votes1),
          salt: generateRandomSalt(),
          nonce: 2n,
          privateKey: users[3].privateKey,
          stateIndex: 4n,
          voteWeight: BigInt(voteWeight1),
          coordinatorPublicKey: coordinatorKeypair.publicKey,
          maxVoteOption: BigInt(MAX_RANKED_VOTE_OPTIONS),
          newPublicKey: users[3].publicKey,
        },
        {
          pollId: 0n,
          voteOptionIndex: packRankedVotesTo50Bits(votes2),
          salt: generateRandomSalt(),
          nonce: 1n,
          privateKey: users[3].privateKey,
          stateIndex: 4n,
          voteWeight: BigInt(voteWeight2),
          coordinatorPublicKey: coordinatorKeypair.publicKey,
          maxVoteOption: BigInt(MAX_RANKED_VOTE_OPTIONS),
          newPublicKey: users[3].publicKey,
        },
      ];

      const messages = votes
        .map((vote) => generateVote({ ...vote, isRanked: true }))
        .map(({ message, ephemeralKeypair }) => ({
          maciAddress: maciAddresses.maciContractAddress,
          poll: 0,
          data: message.data.map(String),
          publicKey: ephemeralKeypair.publicKey.asArray().map(String),
          hash: message.hash(ephemeralKeypair.publicKey).toString(),
        }));

      await relayTestMessages({ messages, signer, pollId: 0, maciAddress: maciAddresses.maciContractAddress });
    });

    it("should generate zk-SNARK proofs and verify them", async () => {
      const ipfsMessageBackupFiles = await getBackupFilenames();
      await timeTravel({ seconds: pollDuration, signer });
      await mergeSignups({ ...mergeSignupsArgs, maciAddress: maciAddresses.maciContractAddress, signer });
      const { tallyData: tallyFileData } = await generateProofs({
        ...generateProofsArgs,
        signer,
        maciAddress: maciAddresses.maciContractAddress,
        ipfsMessageBackupFiles,
      });
      await proveOnChain({ ...proveOnChainArgs, maciAddress: maciAddresses.maciContractAddress, signer });
      await verify({ ...(await verifyArgs(signer)) });

      expect(tallyFileData.totalSpentVoiceCredits.spent.toString()).to.eq(
        (voteWeight1 + voteWeight2 + voteWeight3 + voteWeight4).toString(),
      );

      tallyFileData.results.tally.forEach((result, index) => {
        expect(result.toString()).to.eq(
          (
            votes1[index] * voteWeight1 +
            votes2[index] * voteWeight2 +
            votes3[index] * voteWeight3 +
            votes4[index] * voteWeight4
          ).toString(),
        );
      });
    });
  });

  describe("30 signups (31 ballots), 30 messages", () => {
    after(async () => {
      await clean();
    });

    const users = Array.from({ length: 30 }, () => new Keypair());

    before(async () => {
      // deploy the smart contracts
      maciAddresses = await prepareTest();
    });

    it("should signup thirty users", async () => {
      // eslint-disable-next-line @typescript-eslint/prefer-for-of
      for (let i = 0; i < users.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await signup({
          maciAddress: maciAddresses.maciContractAddress,
          maciPublicKey: users[i].publicKey.serialize(),
          sgData: DEFAULT_SG_DATA,
          signer,
        });
      }
    });

    it("should join thirty users", async () => {
      // eslint-disable-next-line @typescript-eslint/prefer-for-of
      for (let i = 0; i < users.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await joinPoll({
          maciAddress: maciAddresses.maciContractAddress,
          privateKey: users[i].privateKey.serialize(),
          pollId: 0n,
          pollJoiningZkey: testPollJoiningZkeyPath,
          useWasm,
          pollJoiningWasm: testPollJoiningWasmPath,
          pollWitnessGenerator: testPollJoiningWitnessPath,
          rapidsnark: testRapidsnarkPath,
          sgDataArg: DEFAULT_SG_DATA,
          ivcpDataArg: DEFAULT_IVCP_DATA,
          signer,
        });
      }
    });

    it("should publish 30 messages", async () => {
      // eslint-disable-next-line @typescript-eslint/prefer-for-of
      for (let i = 0; i < users.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await publish({
          maciAddress: maciAddresses.maciContractAddress,
          publicKey: users[i].publicKey.serialize(),
          stateIndex: BigInt(i + 1),
          voteOptionIndex: packRankedVotesTo50Bits(votes1),
          nonce: 1n,
          pollId: 0n,
          newVoteWeight: BigInt(DEFAULT_INITIAL_VOICE_CREDITS),
          salt: generateRandomSalt(),
          privateKey: users[i].privateKey.serialize(),
          signer,
          isRanked: true,
        });
      }
    });

    it("should generate zk-SNARK proofs and verify them", async () => {
      await timeTravel({ seconds: pollDuration, signer });
      await mergeSignups({ ...mergeSignupsArgs, maciAddress: maciAddresses.maciContractAddress, signer });
      const { tallyData: tallyFileData } = await generateProofs({
        ...generateProofsArgs,
        maciAddress: maciAddresses.maciContractAddress,
        signer,
      });
      await proveOnChain({ ...proveOnChainArgs, maciAddress: maciAddresses.maciContractAddress, signer });
      await verify({ ...(await verifyArgs(signer)), tallyData: tallyFileData });

      const totalSpent = (DEFAULT_INITIAL_VOICE_CREDITS * users.length).toString();

      expect(tallyFileData.totalSpentVoiceCredits.spent.toString()).to.eq(totalSpent);

      tallyFileData.results.tally.forEach((result, index) => {
        expect(result.toString()).to.eq((30 * votes1[index] * DEFAULT_INITIAL_VOICE_CREDITS).toString());
      });

      // expect the tally sum to be totalSpentVoiceCredits
      const tallySum = tallyFileData.results.tally.reduce((a, b) => a + Number(b), 0);
      const votesSum = votes1.reduce((a, b) => a + b, 0);
      expect(tallySum.toString()).to.eq((Number(totalSpent) * votesSum).toString());
    });
  });

  describe("30 signups, 20 invalid and 1 valid messages", () => {
    after(async () => {
      await clean();
    });

    const users = Array.from({ length: 30 }, () => new Keypair());

    before(async () => {
      // deploy the smart contracts
      maciAddresses = await prepareTest();
    });

    it("should signup thirty users", async () => {
      // eslint-disable-next-line @typescript-eslint/prefer-for-of
      for (let i = 0; i < users.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await signup({
          maciAddress: maciAddresses.maciContractAddress,
          maciPublicKey: users[i].publicKey.serialize(),
          sgData: DEFAULT_SG_DATA,
          signer,
        });
      }
    });

    it("should join thirty users", async () => {
      // eslint-disable-next-line @typescript-eslint/prefer-for-of
      for (let i = 0; i < users.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await joinPoll({
          maciAddress: maciAddresses.maciContractAddress,
          privateKey: users[i].privateKey.serialize(),
          pollId: 0n,
          pollJoiningZkey: testPollJoiningZkeyPath,
          useWasm,
          pollJoiningWasm: testPollJoiningWasmPath,
          pollWitnessGenerator: testPollJoiningWitnessPath,
          rapidsnark: testRapidsnarkPath,
          sgDataArg: DEFAULT_SG_DATA,
          ivcpDataArg: DEFAULT_IVCP_DATA,
          signer,
        });
      }
    });

    it("should publish 30 invalid and 1 valid messages", async () => {
      // eslint-disable-next-line @typescript-eslint/prefer-for-of
      for (let i = 0; i < users.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await publish({
          maciAddress: maciAddresses.maciContractAddress,
          publicKey: users[i].publicKey.serialize(),
          stateIndex: BigInt(i + 1),
          voteOptionIndex: 0n,
          nonce: 1n,
          pollId: 0n,
          newVoteWeight: BigInt(DEFAULT_INITIAL_VOICE_CREDITS + 10),
          salt: generateRandomSalt(),
          privateKey: users[i].privateKey.serialize(),
          signer,
          isRanked: true,
        });
      }

      await publish({
        maciAddress: maciAddresses.maciContractAddress,
        publicKey: users[0].publicKey.serialize(),
        stateIndex: 1n,
        voteOptionIndex: packRankedVotesTo50Bits(votes3),
        nonce: 1n,
        pollId: 0n,
        newVoteWeight: BigInt(DEFAULT_INITIAL_VOICE_CREDITS),
        salt: generateRandomSalt(),
        privateKey: users[0].privateKey.serialize(),
        signer,
        isRanked: true,
      });
    });

    it("should generate zk-SNARK proofs and verify them", async () => {
      await timeTravel({ seconds: pollDuration, signer });
      await mergeSignups({ ...mergeSignupsArgs, maciAddress: maciAddresses.maciContractAddress, signer });
      const { tallyData: tallyFileData } = await generateProofs({
        ...generateProofsArgs,
        maciAddress: maciAddresses.maciContractAddress,
        signer,
      });
      await proveOnChain({ ...proveOnChainArgs, maciAddress: maciAddresses.maciContractAddress, signer });
      await verify({ ...(await verifyArgs(signer)), tallyData: tallyFileData });

      const totalSpent = DEFAULT_INITIAL_VOICE_CREDITS.toString();

      expect(tallyFileData.totalSpentVoiceCredits.spent.toString()).to.eq(totalSpent);
      tallyFileData.results.tally.forEach((result, index) => {
        expect(result.toString()).to.eq((votes3[index] * DEFAULT_INITIAL_VOICE_CREDITS).toString());
      });
    });
  });
});
