import { generateRandomSalt } from "@extended-maci/crypto";
import { VoteCommand, Keypair } from "@extended-maci/domainobjs";
import { expect } from "chai";
import { type WitnessTester } from "circomkit";

import { getSignal, circomkitInstance } from "./utils/utils";

describe("StateLeafAndBallotTransformer circuit", function test() {
  this.timeout(90000);

  // variables needed for testing
  const keypair = new Keypair();
  const stateIndex = BigInt(1);
  const newPublicKey = keypair.publicKey;
  const voteOptionIndex = BigInt(0);
  const newVoteWeight = BigInt(9);
  const nonce = BigInt(1);
  const pollId = BigInt(0);
  const salt = generateRandomSalt();
  const totalSignups = 25n;
  const maxVoteOptions = 25n;

  const stateLeafKeypair = new Keypair();
  const stateLeafPublicKey = stateLeafKeypair.publicKey;

  const stateLeafVoiceCreditBalance = BigInt(100);
  const ballotNonce = BigInt(0);
  const ballotCurrentVotesForOption = BigInt(0);

  const command: VoteCommand = new VoteCommand(
    stateIndex,
    newPublicKey,
    voteOptionIndex,
    newVoteWeight,
    nonce,
    pollId,
    salt,
  );

  const signature = command.sign(stateLeafKeypair.privateKey);

  let circuit: WitnessTester<
    [
      "totalSignups",
      "voteOptions",
      "stateLeafPublicKey",
      "stateLeafVoiceCreditBalance",
      "ballotNonce",
      "ballotCurrentVotesForOption",
      "commandStateIndex",
      "commandPublicKey",
      "commandVoteOptionIndex",
      "commandNewVoteWeight",
      "commandNonce",
      "commandPollId",
      "commandSalt",
      "commandSignaturePoint",
      "commandSignatureScalar",
      "packedCommand",
    ],
    ["newStateLeafPublicKey", "newBallotNonce", "isValid", "isStateLeafIndexValid", "isVoteOptionIndexValid"]
  >;

  let circuitNonQv: WitnessTester<
    [
      "totalSignups",
      "voteOptions",
      "stateLeafPublicKey",
      "stateLeafVoiceCreditBalance",
      "ballotNonce",
      "ballotCurrentVotesForOption",
      "commandStateIndex",
      "commandPublicKey",
      "commandVoteOptionIndex",
      "commandNewVoteWeight",
      "commandNonce",
      "commandPollId",
      "commandSalt",
      "commandSignaturePoint",
      "commandSignatureScalar",
      "packedCommand",
    ],
    ["newStateLeafPublicKey", "newBallotNonce", "isValid", "isStateLeafIndexValid", "isVoteOptionIndexValid"]
  >;

  before(async () => {
    circuit = await circomkitInstance.WitnessTester("StateLeafAndBallotTransformer", {
      file: "./utils/qv/StateLeafAndBallotTransformer",
      template: "StateLeafAndBallotTransformer",
    });

    circuitNonQv = await circomkitInstance.WitnessTester("StateLeafAndBallotTransformerNonQv", {
      file: "./utils/non-qv/StateLeafAndBallotTransformer",
      template: "StateLeafAndBallotTransformerNonQv",
    });
  });

  it("should output new state leaf and ballot values if the command is valid", async () => {
    const circuitInputs = {
      totalSignups,
      voteOptions: maxVoteOptions,
      stateLeafPublicKey: stateLeafPublicKey.asCircuitInputs() as unknown as [bigint, bigint],
      stateLeafVoiceCreditBalance,
      ballotNonce,
      ballotCurrentVotesForOption,
      commandStateIndex: command.stateIndex,
      commandPublicKey: command.newPublicKey.asCircuitInputs() as unknown as [bigint, bigint],
      commandVoteOptionIndex: command.voteOptionIndex,
      commandNewVoteWeight: command.newVoteWeight,
      commandNonce: command.nonce,
      commandPollId: command.pollId,
      commandSalt: command.salt,
      commandSignaturePoint: signature.R8 as [bigint, bigint],
      commandSignatureScalar: signature.S as bigint,
      packedCommand: command.asCircuitInputs(),
    };

    const witness = await circuit.calculateWitness(circuitInputs);
    await circuit.expectConstraintPass(witness);

    const newStateLeafPublicKey0 = await getSignal(circuit, witness, "newStateLeafPublicKey[0]");
    const newStateLeafPublicKey1 = await getSignal(circuit, witness, "newStateLeafPublicKey[1]");
    const newBallotNonce = await getSignal(circuit, witness, "newBallotNonce");

    expect(newStateLeafPublicKey0.toString()).to.be.eq(command.newPublicKey.raw[0].toString());
    expect(newStateLeafPublicKey1.toString()).to.be.eq(command.newPublicKey.raw[1].toString());
    expect(newBallotNonce.toString()).to.be.eq(command.nonce.toString());

    const isValid = await getSignal(circuit, witness, "isValid");
    expect(isValid.toString()).to.be.eq("1");
  });

  it("should output new state leaf and ballot values if the command is valid (non-quadratic voting)", async () => {
    const circuitInputs = {
      totalSignups,
      voteOptions: maxVoteOptions,
      stateLeafPublicKey: stateLeafPublicKey.asCircuitInputs() as unknown as [bigint, bigint],
      stateLeafVoiceCreditBalance,
      ballotNonce,
      ballotCurrentVotesForOption,
      commandStateIndex: command.stateIndex,
      commandPublicKey: command.newPublicKey.asCircuitInputs() as unknown as [bigint, bigint],
      commandVoteOptionIndex: command.voteOptionIndex,
      commandNewVoteWeight: command.newVoteWeight,
      commandNonce: command.nonce,
      commandPollId: command.pollId,
      commandSalt: command.salt,
      commandSignaturePoint: signature.R8 as [bigint, bigint],
      commandSignatureScalar: signature.S as bigint,
      packedCommand: command.asCircuitInputs(),
    };

    const witness = await circuitNonQv.calculateWitness(circuitInputs);
    await circuitNonQv.expectConstraintPass(witness);

    const newStateLeafPublicKey0 = await getSignal(circuitNonQv, witness, "newStateLeafPublicKey[0]");
    const newStateLeafPublicKey1 = await getSignal(circuitNonQv, witness, "newStateLeafPublicKey[1]");
    const newBallotNonce = await getSignal(circuitNonQv, witness, "newBallotNonce");

    expect(newStateLeafPublicKey0.toString()).to.be.eq(command.newPublicKey.raw[0].toString());
    expect(newStateLeafPublicKey1.toString()).to.be.eq(command.newPublicKey.raw[1].toString());
    expect(newBallotNonce.toString()).to.be.eq(command.nonce.toString());

    const isValid = await getSignal(circuitNonQv, witness, "isValid");
    expect(isValid.toString()).to.be.eq("1");
  });

  it("should output existing state leaf and ballot values if the command is invalid", async () => {
    const circuitInputs = {
      totalSignups,
      voteOptions: maxVoteOptions,
      stateLeafPublicKey: stateLeafPublicKey.asCircuitInputs() as unknown as [bigint, bigint],
      stateLeafVoiceCreditBalance,
      ballotNonce,
      ballotCurrentVotesForOption,
      commandStateIndex: command.stateIndex,
      commandPublicKey: command.newPublicKey.asCircuitInputs() as unknown as [bigint, bigint],
      commandVoteOptionIndex: command.voteOptionIndex,
      commandNewVoteWeight: command.newVoteWeight,
      commandNonce: 2n, // invalid
      commandPollId: command.pollId,
      commandSalt: command.salt,
      commandSignaturePoint: signature.R8 as [bigint, bigint],
      commandSignatureScalar: signature.S as bigint,
      packedCommand: command.asCircuitInputs(),
    };

    const witness = await circuit.calculateWitness(circuitInputs);
    await circuit.expectConstraintPass(witness);

    const newStateLeafPublicKey0 = await getSignal(circuit, witness, "newStateLeafPublicKey[0]");
    const newStateLeafPublicKey1 = await getSignal(circuit, witness, "newStateLeafPublicKey[1]");
    const newBallotNonce = await getSignal(circuit, witness, "newBallotNonce");

    expect(newStateLeafPublicKey0.toString()).to.be.eq(stateLeafPublicKey.raw[0].toString());
    expect(newStateLeafPublicKey1.toString()).to.be.eq(stateLeafPublicKey.raw[1].toString());
    expect(newBallotNonce.toString()).to.be.eq("0");

    const isValid = await getSignal(circuit, witness, "isValid");
    expect(isValid.toString()).to.be.eq("0");
  });

  it("should output existing state leaf and ballot values if the command is invalid (non quadratic-voting)", async () => {
    const circuitInputs = {
      totalSignups,
      voteOptions: maxVoteOptions,
      stateLeafPublicKey: stateLeafPublicKey.asCircuitInputs() as unknown as [bigint, bigint],
      stateLeafVoiceCreditBalance,
      ballotNonce,
      ballotCurrentVotesForOption,
      commandStateIndex: command.stateIndex,
      commandPublicKey: command.newPublicKey.asCircuitInputs() as unknown as [bigint, bigint],
      commandVoteOptionIndex: command.voteOptionIndex,
      commandNewVoteWeight: command.newVoteWeight,
      commandNonce: 2n, // invalid
      commandPollId: command.pollId,
      commandSalt: command.salt,
      commandSignaturePoint: signature.R8 as [bigint, bigint],
      commandSignatureScalar: signature.S as bigint,
      packedCommand: command.asCircuitInputs(),
    };

    const witness = await circuitNonQv.calculateWitness(circuitInputs);
    await circuitNonQv.expectConstraintPass(witness);

    const newStateLeafPublicKey0 = await getSignal(circuitNonQv, witness, "newStateLeafPublicKey[0]");
    const newStateLeafPublicKey1 = await getSignal(circuitNonQv, witness, "newStateLeafPublicKey[1]");
    const newBallotNonce = await getSignal(circuitNonQv, witness, "newBallotNonce");

    expect(newStateLeafPublicKey0.toString()).to.be.eq(stateLeafPublicKey.raw[0].toString());
    expect(newStateLeafPublicKey1.toString()).to.be.eq(stateLeafPublicKey.raw[1].toString());
    expect(newBallotNonce.toString()).to.be.eq("0");

    const isValid = await getSignal(circuitNonQv, witness, "isValid");
    expect(isValid.toString()).to.be.eq("0");
  });
});
