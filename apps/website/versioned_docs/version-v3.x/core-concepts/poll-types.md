---
title: Poll Types
description: Which type of polls you can run on MACI
sidebar_label: Poll types
sidebar_position: 9
---

MACI allows to conduct polls in quadratic voting, non quadratic voting, full credits voting, and ranked choice voting modes. One should be aware that the only distinction between these modes happens when messages are processed and votes tallied. On top of that, the Tally smart contract has been split into different ones, with the non quadratic voting versions being slightly smaller, due to the need of fewer functions. Additionally, there is a variation of non quadratic voting that allows participants to cast their entire voice credit balance for a single option only.

This document will explain how to use each of these options. Hardhat tasks are the currently recommended way to deploy contracts and run polls but you can also use the MACI cli.

## Quadratic Voting

MACI has always worked with quadratic voting. Users signing up to MACI are assigned a number of voice credits based on certain conditions (enforced by the [initial voice credit proxy contract](https://github.com/privacy-scaling-explorations/maci/blob/main/packages/contracts/contracts/initialVoiceCreditProxy/ConstantInitialVoiceCreditProxy.sol)), and after each vote, the number of voice credits is reduced by the square of the weight of the vote casted. For instance, if the vote weight is 5, a user must have at least 25 voice credits to cast the vote.

To run a poll with quadratic voting, the coordinator must deploy the Poll with the mode set to quadratic voting.

### Using Hardhat tasks

In the deploy-config.json file set the `mode` value to **qv**.

```json
"Poll": {
    "pollDuration": 604800,
    "coordinatorPublicKey": "macipk",
    "mode": "qv"
}
```

Then run the task to create a poll:

```bash
pnpm deploy-poll:NETWORK
```

## Non Quadratic Voting

The non quadratic voting option is a new feature that has been added to MACI with the v1.2 release. It allows to conduct polls without the quadratic voting mechanism. This means that the number of voice credits is not reduced by the square of the weight of the vote casted. This option is useful for polls where the quadratic voting mechanism is not necessary, and it is also slightly cheaper for coordinators to tally votes, as there are less checks required in the Tally smart contract.

To run a poll with non quadratic voting, the coordinator must set the `mode` parameter to `non-qv` when creating the MACI instance. This will make the MACI instance use the `TallyNonQv` smart contract, which is a smaller version of the `Tally` smart contract, as it does not require the checks for the quadratic voting mechanism.

### Using Hardhat tasks

In the deploy-config.json file set the `mode` value to **non-qv**.

```json
"Poll": {
    "pollDuration": 604800,
    "coordinatorPublicKey": "macipk",
    "mode": "non-qv"
}
```

Then run the task to create a poll:

```bash
pnpm deploy-poll:NETWORK
```

## Full Credits Voting

Full Credits Voting is a new feature introduced in MACI v3. This voting mode disables the quadratic voting mechanism and requires participants to allocate their entire voice credit balance to a single option. Unlike quadratic voting, where the cost of votes increases quadratically with the number of votes cast, Full Credits Voting uses a linear model: participants spend all their available voice credits on one chosen option. No splitting across multiple options is allowed. This option is useful for polls where the quadratic voting mechanism is not necessary and where it's important to ensure voters fully commit to a single choice—eliminating fragmented or spread-out voting behavior. It also offers a slight cost advantage for coordinators, as tallying is more efficient with fewer checks required in the Tally smart contract.

To run a poll full credits voting, the coordinator must set the `mode` parameter to `full` when creating the MACI instance. This will make the MACI instance use the `TallyNonQv` smart contract, which is a smaller version of the `Tally` smart contract, as it does not require the checks for the quadratic voting mechanism.

### Using Hardhat tasks

In the deploy-config.json file set the `mode` value to **full**.

```json
"Poll": {
    "pollDuration": 604800,
    "coordinatorPublicKey": "macipk",
    "mode": "full"
}
```

Then run the task to create a poll:

```bash
pnpm deploy-poll:NETWORK
```

## Ranked Choice Voting

Ranked Choice Voting is a new feature introduced in MACI. This voting mode allows participants to rank vote options in order of preference, rather than allocating voice credits. Voters can specify their first choice, second choice, and so on up to a maximum of 12 options.

To run a poll with ranked choice voting, the coordinator must set the `mode` parameter to `ranked` when creating the Poll instance. This will make the Poll instance use specialized ranked choice circuits for processing and tallying.

**Important Limitations:**

- Maximum of 12 vote options per poll
- Vote options are limited to ensure circuit performance and verification efficiency

### Using Hardhat tasks

In the deploy-config.json file set the `mode` value to **ranked**.

```json
"Poll": {
    "pollDuration": 604800,
    "coordinatorPublicKey": "macipk",
    "mode": "ranked"
}
```

Then run the task to create a poll:

```bash
pnpm deploy-poll:NETWORK
```
