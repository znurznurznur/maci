import { Address, BigInt as GraphBN, ethereum } from "@graphprotocol/graph-ts";
// eslint-disable-next-line import/no-extraneous-dependencies
import { newMockEvent } from "matchstick-as";

import { SignUp, DeployPoll, OwnershipTransferred } from "../../generated/MACI/MACI";
import { DEFAULT_POLL_ADDRESS, DEFAULT_MESSAGE_PROCESSOR_ADDRESS, DEFAULT_TALLY_ADDRESS } from "../common";

export function createSignUpEvent(
  stateIndex: GraphBN,
  userPublicKeyX: GraphBN,
  userPublicKeyY: GraphBN,
  voiceCreditBalance: GraphBN,
  timestamp: GraphBN,
): SignUp {
  const event = changetype<SignUp>(newMockEvent());

  event.parameters.push(new ethereum.EventParam("_stateIndex", ethereum.Value.fromUnsignedBigInt(stateIndex)));
  event.parameters.push(new ethereum.EventParam("_userPublicKeyX", ethereum.Value.fromUnsignedBigInt(userPublicKeyX)));
  event.parameters.push(new ethereum.EventParam("_userPublicKeyY", ethereum.Value.fromUnsignedBigInt(userPublicKeyY)));
  event.parameters.push(
    new ethereum.EventParam("_voiceCreditBalance", ethereum.Value.fromUnsignedBigInt(voiceCreditBalance)),
  );
  event.parameters.push(new ethereum.EventParam("_timestamp", ethereum.Value.fromUnsignedBigInt(timestamp)));

  return event;
}

export function createDeployPollEvent(
  pollId: GraphBN,
  coordinatorPublicKeyX: GraphBN,
  coordinatorPublicKeyY: GraphBN,
  mode: GraphBN,
): DeployPoll {
  const event = changetype<DeployPoll>(newMockEvent());

  const coordinatorPubKey = changetype<ethereum.Tuple>([
    ethereum.Value.fromUnsignedBigInt(coordinatorPublicKeyX),
    ethereum.Value.fromUnsignedBigInt(coordinatorPublicKeyY),
  ]);

  const pollData = changetype<ethereum.Tuple>([
    ethereum.Value.fromUnsignedBigInt(pollId), // id
    ethereum.Value.fromString("Test Poll"), // name
    ethereum.Value.fromString(""), // metadata
    ethereum.Value.fromUnsignedBigInt(GraphBN.fromI32(30)), // startTime
    ethereum.Value.fromUnsignedBigInt(GraphBN.fromI32(40)), // endTime
    ethereum.Value.fromStringArray([]), // options
    ethereum.Value.fromBytesArray([]), // optionInfo
    ethereum.Value.fromTuple(coordinatorPubKey), // coordinatorPubKey
    ethereum.Value.fromAddress(Address.zero()), // pollDeployer
    ethereum.Value.fromI32(mode.toI32()), // mode
    ethereum.Value.fromAddress(Address.zero()), // policy
    ethereum.Value.fromI32(0), // policyType
  ]);

  const pollContracts = changetype<ethereum.Tuple>([
    ethereum.Value.fromAddress(DEFAULT_POLL_ADDRESS),
    ethereum.Value.fromAddress(DEFAULT_MESSAGE_PROCESSOR_ADDRESS),
    ethereum.Value.fromAddress(DEFAULT_TALLY_ADDRESS),
  ]);

  event.parameters.push(new ethereum.EventParam("pollData", ethereum.Value.fromTuple(pollData)));
  event.parameters.push(new ethereum.EventParam("pollContracts", ethereum.Value.fromTuple(pollContracts)));

  return event;
}

export function createOwnershipTransferredEvent(previousOwner: Address, newOwner: Address): OwnershipTransferred {
  const event = changetype<OwnershipTransferred>(newMockEvent());

  event.parameters.push(new ethereum.EventParam("previousOwner", ethereum.Value.fromAddress(previousOwner)));
  event.parameters.push(new ethereum.EventParam("newOwner", ethereum.Value.fromAddress(newOwner)));

  return event;
}
