/* eslint-disable no-underscore-dangle */
import { Address, BigInt as GraphBN } from "@graphprotocol/graph-ts";

import {
  DeployPoll as DeployPollEvent,
  SignUp as SignUpEvent,
  OwnershipTransferred as OwnershipTransferredEvent,
} from "../generated/MACI/MACI";
import { Poll } from "../generated/schema";
import { Poll as PollTemplate } from "../generated/templates";
import { Poll as PollContract } from "../generated/templates/Poll/Poll";

import { ONE_BIG_INT } from "./utils/constants";
import { createOrLoadMACI, createOrLoadUser, createOrLoadAccount } from "./utils/entity";

export function handleDeployPoll(event: DeployPollEvent): void {
  const maci = createOrLoadMACI(event);

  const pollContractAddress = event.params.pollContracts.poll;
  const poll = new Poll(pollContractAddress);
  const pollContract = PollContract.bind(pollContractAddress);
  const voteOptions = pollContract.voteOptions();
  const treeDepths = pollContract.treeDepths();

  poll.pollId = event.params.pollData.id;
  poll.messageProcessor = event.params.pollContracts.messageProcessor;
  poll.tally = event.params.pollContracts.tally;
  poll.registrationCount = GraphBN.fromI32(0);
  poll.voteOptions = voteOptions;
  poll.treeDepth = GraphBN.fromI32(treeDepths.value0);
  poll.duration = event.params.pollData.endTime.minus(event.params.pollData.startTime);
  poll.startDate = event.params.pollData.startTime;
  poll.endDate = event.params.pollData.endTime;
  poll.mode = GraphBN.fromI32(event.params.pollData.mode);
  poll.policy = event.params.pollData.policy;
  poll.policyType = GraphBN.fromI32(event.params.pollData.policyType);
  poll.name = event.params.pollData.name;
  poll.metadata = event.params.pollData.metadata;
  poll.options = event.params.pollData.options;

  const optionInfoRaw = event.params.pollData.optionInfo;
  const optionInfoStrings = new Array<string>(optionInfoRaw.length);
  for (let i = 0; i < optionInfoRaw.length; i += 1) {
    optionInfoStrings[i] = optionInfoRaw[i].toHexString();
  }
  poll.optionInfo = optionInfoStrings;
  poll.createdAt = event.block.timestamp;
  poll.updatedAt = event.block.timestamp;
  poll.owner = event.transaction.from;

  // No users would have joined the poll yet
  poll.totalSignups = GraphBN.zero();
  poll.numMessages = GraphBN.zero();
  poll.maci = maci.id;
  poll.save();

  maci.numPoll = maci.numPoll.plus(ONE_BIG_INT);
  maci.latestPoll = poll.id;
  maci.updatedAt = event.block.timestamp;
  maci.save();

  // Start indexing the new poll contract
  PollTemplate.create(Address.fromBytes(pollContractAddress));
}

export function handleSignUp(event: SignUpEvent): void {
  const user = createOrLoadUser(event.params._userPublicKeyX, event.params._userPublicKeyY, event);
  createOrLoadAccount(event.params._stateIndex, event, user.id, GraphBN.zero());

  const maci = createOrLoadMACI(event);
  maci.totalSignups = maci.totalSignups.plus(ONE_BIG_INT);
  maci.updatedAt = event.block.timestamp;
  maci.save();

  const poll = Poll.load(maci.latestPoll);

  if (poll) {
    poll.totalSignups = poll.totalSignups.plus(ONE_BIG_INT);
    poll.updatedAt = event.block.timestamp;
    poll.save();
  }
}

export function handleOwnershipTransferred(event: OwnershipTransferredEvent): void {
  const maci = createOrLoadMACI(event);

  maci.owner = event.params.newOwner;
  maci.updatedAt = event.block.timestamp;
  maci.save();
}
