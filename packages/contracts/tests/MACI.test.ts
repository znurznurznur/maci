/* eslint-disable no-underscore-dangle */
import { EMode, MaciState, EPolicy } from "@extended-maci/core";
import { MAX_RANKED_VOTE_OPTIONS } from "@extended-maci/core/build/ts/utils/constants";
import { NOTHING_UP_MY_SLEEVE } from "@extended-maci/crypto";
import { Keypair, PublicKey, Message } from "@extended-maci/domainobjs";
import { expect } from "chai";
import { AbiCoder, type BigNumberish, type Signer, ZeroAddress } from "ethers";

import { getDefaultSigner, getSigners, getBlockTimestamp } from "../ts/utils";
import { type MACI, type IBasePolicy, type ConstantInitialVoiceCreditProxy } from "../typechain-types";

import {
  STATE_TREE_DEPTH,
  duration,
  initialVoiceCreditBalance,
  maxVoteOptions,
  messageBatchSize,
  treeDepths,
} from "./constants";
import { deployTestContracts } from "./utils";

const ALL_MODES = Object.values(EMode).filter((v): v is EMode => typeof v === "number");
const ALL_POLICIES = Object.values(EPolicy).filter((v): v is EPolicy => typeof v === "number");

describe("MACI", function test() {
  this.timeout(900000); // 15 minutes

  let maciContract: MACI;
  let signuPolicyContract: IBasePolicy;
  let initialVoiceCreditProxy: ConstantInitialVoiceCreditProxy;
  let pollId: bigint;

  const coordinator = new Keypair();
  const users = [new Keypair(), new Keypair(), new Keypair()];

  let signer: Signer;

  const maciState = new MaciState(STATE_TREE_DEPTH);

  const buildPollArgs = (
    startTime: number,
    overrides: Partial<{
      mode: EMode;
      policyType: EPolicy;
      voteOptions: number;
    }> = {},
  ) => ({
    startDate: startTime,
    endDate: startTime + duration,
    treeDepths,
    messageBatchSize,
    coordinatorPublicKey: coordinator.publicKey.asContractParam() as { x: BigNumberish; y: BigNumberish },
    mode: overrides.mode ?? EMode.QV,
    policy: signuPolicyContract,
    initialVoiceCreditProxy,
    relayers: [ZeroAddress],
    voteOptions: overrides.voteOptions ?? maxVoteOptions,
    name: "",
    metadata: "",
    options: [],
    optionInfo: [],
    policyType: overrides.policyType ?? EPolicy.FreeForAll,
  });

  describe("Deployment", () => {
    before(async () => {
      signer = await getDefaultSigner();
      const r = await deployTestContracts({
        initialVoiceCreditBalance,
        stateTreeDepth: STATE_TREE_DEPTH,
        signer,
      });

      maciContract = r.maciContract;
      signuPolicyContract = r.policyContract;
      initialVoiceCreditProxy = r.constantInitialVoiceCreditProxyContract;

      await signuPolicyContract.setTarget(await maciContract.getAddress()).then((tx) => tx.wait());
    });

    it("should have set the correct stateTreeDepth", async () => {
      const std = await maciContract.stateTreeDepth();
      expect(std.toString()).to.eq(STATE_TREE_DEPTH.toString());
    });

    it("should be possible to deploy Maci contracts with different state tree depth values", async () => {
      const checkStateTreeDepth = async (stateTreeDepthTest: number): Promise<void> => {
        const { maciContract: testMaci } = await deployTestContracts({
          initialVoiceCreditBalance,
          stateTreeDepth: stateTreeDepthTest,
          signer,
        });
        expect(await testMaci.stateTreeDepth()).to.eq(stateTreeDepthTest);
      };

      await checkStateTreeDepth(1);
      await checkStateTreeDepth(2);
      await checkStateTreeDepth(3);
    });
  });

  describe("Signups", () => {
    it("should sign up multiple users", async () => {
      for (let index = 0; index < users.length; index += 1) {
        const user = users[index];

        // eslint-disable-next-line no-await-in-loop
        const tx = await maciContract.signUp(
          user.publicKey.asContractParam(),
          AbiCoder.defaultAbiCoder().encode(["uint256"], [1]),
        );
        // eslint-disable-next-line no-await-in-loop
        const receipt = await tx.wait();
        expect(receipt?.status).to.eq(1);

        // eslint-disable-next-line no-await-in-loop
        const [event] = await maciContract.queryFilter(
          maciContract.filters.SignUp,
          receipt?.blockNumber,
          receipt?.blockNumber,
        );

        expect(event.args._stateIndex.toString()).to.eq((index + 1).toString());

        maciState.signUp(user.publicKey);
      }
    });

    it("should fail when given an invalid publicKey (x >= p)", async () => {
      await expect(
        maciContract.signUp(
          {
            x: "21888242871839275222246405745257275088548364400416034343698204186575808495617",
            y: "0",
          },
          AbiCoder.defaultAbiCoder().encode(["uint256"], [1]),
        ),
      ).to.be.revertedWithCustomError(maciContract, "InvalidPublicKey");
    });

    it("should fail when given an invalid publicKey (y >= p)", async () => {
      await expect(
        maciContract.signUp(
          {
            x: "1",
            y: "21888242871839275222246405745257275088548364400416034343698204186575808495617",
          },
          AbiCoder.defaultAbiCoder().encode(["uint256"], [1]),
        ),
      ).to.be.revertedWithCustomError(maciContract, "InvalidPublicKey");
    });

    it("should fail when given an invalid publicKey (x >= p and y >= p)", async () => {
      await expect(
        maciContract.signUp(
          {
            x: "21888242871839275222246405745257275088548364400416034343698204186575808495617",
            y: "21888242871839275222246405745257275088548364400416034343698204186575808495617",
          },
          AbiCoder.defaultAbiCoder().encode(["uint256"], [1]),
        ),
      ).to.be.revertedWithCustomError(maciContract, "InvalidPublicKey");
    });

    it("should fail when given an invalid public key (not on the curve)", async () => {
      await expect(
        maciContract.signUp(
          {
            x: "1",
            y: "1",
          },
          AbiCoder.defaultAbiCoder().encode(["uint256"], [1]),
        ),
      ).to.be.revertedWithCustomError(maciContract, "InvalidPublicKey");
    });

    it("should not allow to sign up more than the supported amount of users (2 ** stateTreeDepth)", async () => {
      const stateTreeDepthTest = 1;
      const maxUsers = 2 ** stateTreeDepthTest;
      const { maciContract: maci, policyContract } = await deployTestContracts({
        initialVoiceCreditBalance,
        stateTreeDepth: stateTreeDepthTest,
        signer,
      });
      await policyContract.setTarget(await maci.getAddress()).then((tx) => tx.wait());
      const keypair = new Keypair();
      // start from one as we already have one signup (blank state leaf)
      for (let i = 1; i < maxUsers; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await maci.signUp(keypair.publicKey.asContractParam(), AbiCoder.defaultAbiCoder().encode(["uint256"], [1]));
      }

      // the next signup should fail
      await expect(
        maci.signUp(keypair.publicKey.asContractParam(), AbiCoder.defaultAbiCoder().encode(["uint256"], [1])),
      ).to.be.revertedWithCustomError(maciContract, "TooManySignups");
    });

    it("should signup 2 ** 10 users", async () => {
      const stateTreeDepthTest = 10;
      const maxUsers = 2 ** stateTreeDepthTest;
      const { maciContract: maci, policyContract } = await deployTestContracts({
        initialVoiceCreditBalance,
        stateTreeDepth: stateTreeDepthTest,
        signer,
      });
      await policyContract.setTarget(await maci.getAddress()).then((tx) => tx.wait());

      // start from one as we already have one signup (blank state leaf)
      for (let i = 1; i < maxUsers; i += 1) {
        const keypair = new Keypair();
        // eslint-disable-next-line no-await-in-loop
        await maci.signUp(keypair.publicKey.asContractParam(), AbiCoder.defaultAbiCoder().encode(["uint256"], [1]));
      }
    });
  });

  describe("getStateIndex", () => {
    it("should return the index of a state leaf", async () => {
      const index = await maciContract.getStateIndex(users[0].publicKey.hash());
      expect(index.toString()).to.eq("1");
    });

    it("should throw when given a public key that is not signed up", async () => {
      await expect(maciContract.getStateIndex(0)).to.be.revertedWithCustomError(maciContract, "UserNotSignedUp");
    });
  });

  describe("Deploy a Poll", () => {
    it("should deploy a poll", async () => {
      const startTime = (await getBlockTimestamp(signer)) + 100;

      // Create the poll and get the poll ID from the tx event logs
      const tx = await maciContract.deployPoll(buildPollArgs(startTime), await signer.getAddress());
      const receipt = await tx.wait();

      expect(receipt?.status).to.eq(1);
      pollId = (await maciContract.nextPollId()) - 1n;

      const poll = maciState.deployPoll(
        BigInt(startTime + duration),
        treeDepths,
        messageBatchSize,
        coordinator,
        BigInt(maxVoteOptions),
        EMode.QV,
      );
      expect(poll.toString()).to.eq(pollId.toString());

      // publish the NOTHING_UP_MY_SLEEVE message
      const messageData = [NOTHING_UP_MY_SLEEVE];
      for (let i = 1; i < 10; i += 1) {
        messageData.push(BigInt(0));
      }
      const message = new Message(messageData);
      const padKey = new PublicKey([
        BigInt("10457101036533406547632367118273992217979173478358440826365724437999023779287"),
        BigInt("19824078218392094440610104313265183977899662750282163392862422243483260492317"),
      ]);
      maciState.polls.get(pollId)?.publishMessage(message, padKey);
    });

    it("should allow to deploy a new poll even before the first one is completed", async () => {
      const startTime = (await getBlockTimestamp(signer)) + 1;
      const tx = await maciContract.deployPoll(buildPollArgs(startTime), await signer.getAddress());
      const receipt = await tx.wait();
      expect(receipt?.status).to.eq(1);
      expect(await maciContract.nextPollId()).to.eq(2);
    });

    it("should allow any user to deploy a poll", async () => {
      const [, user] = await getSigners();
      const startTime = (await getBlockTimestamp(signer)) + 1;
      const tx = await maciContract.connect(user).deployPoll(buildPollArgs(startTime), await user.getAddress());
      const receipt = await tx.wait();
      expect(receipt?.status).to.eq(1);
      expect(await maciContract.nextPollId()).to.eq(3);
    });
  });

  describe("getPoll", () => {
    it("should return an object for a valid id", async () => {
      const { contracts } = await maciContract.getPoll(pollId);
      expect(contracts.poll).to.not.eq(ZeroAddress);
      expect(contracts.messageProcessor).to.not.eq(ZeroAddress);
      expect(contracts.tally).to.not.eq(ZeroAddress);
    });

    it("should throw when given an invalid poll id", async () => {
      await expect(maciContract.getPoll(5)).to.be.revertedWithCustomError(maciContract, "PollDoesNotExist").withArgs(5);
    });
  });

  describe("Ranked Poll Vote Options Validation", () => {
    it("should allow deploying a RANKED poll with voteOptions = MAX_RANKED_VOTE_OPTIONS", async () => {
      const startTime = (await getBlockTimestamp(signer)) + 100;
      const tx = await maciContract.deployPoll(
        buildPollArgs(startTime, { mode: EMode.RANKED, voteOptions: MAX_RANKED_VOTE_OPTIONS }),
        await signer.getAddress(),
      );
      const receipt = await tx.wait();
      expect(receipt?.status).to.eq(1);
    });

    it("should allow deploying a RANKED poll with voteOptions < MAX_RANKED_VOTE_OPTIONS", async () => {
      const startTime = (await getBlockTimestamp(signer)) + 100;
      const tx = await maciContract.deployPoll(
        buildPollArgs(startTime, { mode: EMode.RANKED, voteOptions: MAX_RANKED_VOTE_OPTIONS - 1 }),
        await signer.getAddress(),
      );
      const receipt = await tx.wait();
      expect(receipt?.status).to.eq(1);
    });

    it("should fail when deploying a RANKED poll with voteOptions > MAX_RANKED_VOTE_OPTIONS", async () => {
      const startTime = (await getBlockTimestamp(signer)) + 100;
      await expect(
        maciContract.deployPoll(
          buildPollArgs(startTime, { mode: EMode.RANKED, voteOptions: MAX_RANKED_VOTE_OPTIONS + 1 }),
          await signer.getAddress(),
        ),
      ).to.be.revertedWithCustomError(maciContract, "TooManyVoteOptions");
    });

    it("should allow deploying a QV poll with any number of voteOptions", async () => {
      const startTime = (await getBlockTimestamp(signer)) + 100;
      const tx = await maciContract.deployPoll(
        buildPollArgs(startTime, { mode: EMode.QV, voteOptions: MAX_RANKED_VOTE_OPTIONS + 1 }),
        await signer.getAddress(),
      );
      const receipt = await tx.wait();
      expect(receipt?.status).to.eq(1);
    });
  });

  describe("Ownership", () => {
    it("should set the deployer as owner", async () => {
      expect(await maciContract.owner()).to.eq(await signer.getAddress());
    });

    it("should have no pending owner initially", async () => {
      expect(await maciContract.pendingOwner()).to.eq(ZeroAddress);
    });

    it("should support two-step ownership transfer", async () => {
      const [, newOwner] = await getSigners();
      const newOwnerAddress = await newOwner.getAddress();

      await maciContract.transferOwnership(newOwnerAddress).then((tx) => tx.wait());
      expect(await maciContract.pendingOwner()).to.eq(newOwnerAddress);
      expect(await maciContract.owner()).to.eq(await signer.getAddress());

      await maciContract
        .connect(newOwner)
        .acceptOwnership()
        .then((tx) => tx.wait());
      expect(await maciContract.owner()).to.eq(newOwnerAddress);

      // transfer ownership back so subsequent tests are unaffected
      await maciContract
        .connect(newOwner)
        .transferOwnership(await signer.getAddress())
        .then((tx) => tx.wait());
      await maciContract.acceptOwnership().then((tx) => tx.wait());
    });

    it("should revert when non-pending-owner tries to accept ownership", async () => {
      const [, newOwner, interloper] = await getSigners();
      await maciContract.transferOwnership(await newOwner.getAddress()).then((tx) => tx.wait());

      await expect(maciContract.connect(interloper).acceptOwnership()).to.be.revertedWithCustomError(
        maciContract,
        "OwnableUnauthorizedAccount",
      );

      // cancel by transferring to zero (or just leave — cleanup not needed as tests use fresh contracts)
      await maciContract
        .connect(newOwner)
        .acceptOwnership()
        .then((tx) => tx.wait());
      await maciContract
        .connect(newOwner)
        .transferOwnership(await signer.getAddress())
        .then((tx) => tx.wait());
      await maciContract.acceptOwnership().then((tx) => tx.wait());
    });
  });

  describe("GovernanceConfig", () => {
    let govMaci: MACI;
    let govSignupPolicy: IBasePolicy;
    let govVoiceCreditProxy: ConstantInitialVoiceCreditProxy;

    before(async () => {
      const r = await deployTestContracts({
        initialVoiceCreditBalance,
        stateTreeDepth: STATE_TREE_DEPTH,
        signer,
      });
      govMaci = r.maciContract;
      govSignupPolicy = r.policyContract;
      govVoiceCreditProxy = r.constantInitialVoiceCreditProxyContract;
      await govSignupPolicy.setTarget(await govMaci.getAddress()).then((tx) => tx.wait());
    });

    describe("getGovernanceConfig", () => {
      it("should return all modes as supported by default", async () => {
        const config = await govMaci.getGovernanceConfig();
        const modes = config.supportedModes.map((m: bigint) => Number(m));
        expect(modes).to.have.members(ALL_MODES);
      });

      it("should return all policies as allowed by default", async () => {
        const config = await govMaci.getGovernanceConfig();
        const policies = config.allowedPolicies.map((p: bigint) => Number(p));
        expect(policies).to.have.members(ALL_POLICIES);
      });
    });

    describe("setSupportedModes", () => {
      it("should allow the owner to restrict supported modes", async () => {
        await govMaci.setSupportedModes([EMode.QV]).then((tx) => tx.wait());
        const config = await govMaci.getGovernanceConfig();
        const modes = config.supportedModes.map((m: bigint) => Number(m));
        expect(modes).to.deep.equal([EMode.QV]);
      });

      it("should emit SupportedModesUpdated event", async () => {
        await expect(govMaci.setSupportedModes([EMode.QV, EMode.NON_QV]))
          .to.emit(govMaci, "SupportedModesUpdated")
          .withArgs([EMode.QV, EMode.NON_QV]);
      });

      it("should revert when called by non-owner", async () => {
        const [, nonOwner] = await getSigners();
        await expect(govMaci.connect(nonOwner).setSupportedModes([EMode.QV])).to.be.revertedWithCustomError(
          govMaci,
          "OwnableUnauthorizedAccount",
        );
      });

      it("should revert with EmptySupportedModes when passed an empty array", async () => {
        await expect(govMaci.setSupportedModes([])).to.be.revertedWithCustomError(govMaci, "EmptySupportedModes");
      });

      it("should prevent deploying a poll with an unsupported mode", async () => {
        // restrict to QV only
        await govMaci.setSupportedModes([EMode.QV]).then((tx) => tx.wait());

        const startTime = (await getBlockTimestamp(signer)) + 100;
        await expect(
          govMaci.deployPoll(
            {
              startDate: startTime,
              endDate: startTime + duration,
              treeDepths,
              messageBatchSize,
              coordinatorPublicKey: coordinator.publicKey.asContractParam() as { x: BigNumberish; y: BigNumberish },
              mode: EMode.NON_QV,
              policy: govSignupPolicy,
              initialVoiceCreditProxy: govVoiceCreditProxy,
              relayers: [ZeroAddress],
              voteOptions: maxVoteOptions,
              name: "",
              metadata: "",
              options: [],
              optionInfo: [],
              policyType: EPolicy.FreeForAll,
            },
            await signer.getAddress(),
          ),
        ).to.be.revertedWithCustomError(govMaci, "UnsupportedMode");
      });

      it("should allow deploying a poll with a supported mode", async () => {
        const startTime = (await getBlockTimestamp(signer)) + 100;
        const tx = await govMaci.deployPoll(
          {
            startDate: startTime,
            endDate: startTime + duration,
            treeDepths,
            messageBatchSize,
            coordinatorPublicKey: coordinator.publicKey.asContractParam() as { x: BigNumberish; y: BigNumberish },
            mode: EMode.QV,
            policy: govSignupPolicy,
            initialVoiceCreditProxy: govVoiceCreditProxy,
            relayers: [ZeroAddress],
            voteOptions: maxVoteOptions,
            name: "",
            metadata: "",
            options: [],
            optionInfo: [],
            policyType: EPolicy.FreeForAll,
          },
          await signer.getAddress(),
        );
        const receipt = await tx.wait();
        expect(receipt?.status).to.eq(1);
      });

      it("should reflect updated modes after a second call", async () => {
        await govMaci.setSupportedModes(ALL_MODES).then((tx) => tx.wait());
        const config = await govMaci.getGovernanceConfig();
        const modes = config.supportedModes.map((m: bigint) => Number(m));
        expect(modes).to.have.members(ALL_MODES);
      });
    });

    describe("setAllowedPolicies", () => {
      it("should allow the owner to restrict allowed policies", async () => {
        await govMaci.setAllowedPolicies([EPolicy.FreeForAll]).then((tx) => tx.wait());
        const config = await govMaci.getGovernanceConfig();
        const policies = config.allowedPolicies.map((p: bigint) => Number(p));
        expect(policies).to.deep.equal([EPolicy.FreeForAll]);
      });

      it("should emit AllowedPoliciesUpdated event", async () => {
        await expect(govMaci.setAllowedPolicies([EPolicy.FreeForAll, EPolicy.ERC20]))
          .to.emit(govMaci, "AllowedPoliciesUpdated")
          .withArgs([EPolicy.FreeForAll, EPolicy.ERC20]);
      });

      it("should revert when called by non-owner", async () => {
        const [, nonOwner] = await getSigners();
        await expect(govMaci.connect(nonOwner).setAllowedPolicies([EPolicy.FreeForAll])).to.be.revertedWithCustomError(
          govMaci,
          "OwnableUnauthorizedAccount",
        );
      });

      it("should revert with EmptyAllowedPolicies when passed an empty array", async () => {
        await expect(govMaci.setAllowedPolicies([])).to.be.revertedWithCustomError(govMaci, "EmptyAllowedPolicies");
      });

      it("should prevent deploying a poll with a disallowed policy type", async () => {
        // allow only FreeForAll
        await govMaci.setAllowedPolicies([EPolicy.FreeForAll]).then((tx) => tx.wait());

        const startTime = (await getBlockTimestamp(signer)) + 100;
        await expect(
          govMaci.deployPoll(
            {
              startDate: startTime,
              endDate: startTime + duration,
              treeDepths,
              messageBatchSize,
              coordinatorPublicKey: coordinator.publicKey.asContractParam() as { x: BigNumberish; y: BigNumberish },
              mode: EMode.QV,
              policy: govSignupPolicy,
              initialVoiceCreditProxy: govVoiceCreditProxy,
              relayers: [ZeroAddress],
              voteOptions: maxVoteOptions,
              name: "",
              metadata: "",
              options: [],
              optionInfo: [],
              policyType: EPolicy.ERC20,
            },
            await signer.getAddress(),
          ),
        ).to.be.revertedWithCustomError(govMaci, "UnsupportedPolicy");
      });

      it("should allow deploying a poll with an allowed policy type", async () => {
        const startTime = (await getBlockTimestamp(signer)) + 100;
        const tx = await govMaci.deployPoll(
          {
            startDate: startTime,
            endDate: startTime + duration,
            treeDepths,
            messageBatchSize,
            coordinatorPublicKey: coordinator.publicKey.asContractParam() as { x: BigNumberish; y: BigNumberish },
            mode: EMode.QV,
            policy: govSignupPolicy,
            initialVoiceCreditProxy: govVoiceCreditProxy,
            relayers: [ZeroAddress],
            voteOptions: maxVoteOptions,
            name: "",
            metadata: "",
            options: [],
            optionInfo: [],
            policyType: EPolicy.FreeForAll,
          },
          await signer.getAddress(),
        );
        const receipt = await tx.wait();
        expect(receipt?.status).to.eq(1);
      });

      it("should reflect updated policies after a second call", async () => {
        await govMaci.setAllowedPolicies(ALL_POLICIES).then((tx) => tx.wait());
        const config = await govMaci.getGovernanceConfig();
        const policies = config.allowedPolicies.map((p: bigint) => Number(p));
        expect(policies).to.have.members(ALL_POLICIES);
      });
    });

    describe("deployment with restricted initial config", () => {
      it("should deploy with only QV mode supported and enforce it", async () => {
        const r = await deployTestContracts({
          initialVoiceCreditBalance,
          stateTreeDepth: STATE_TREE_DEPTH,
          signer,
          initialSupportedModes: [EMode.QV],
          initialAllowedPolicies: ALL_POLICIES,
        });
        const restrictedMaci = r.maciContract;
        await r.policyContract.setTarget(await restrictedMaci.getAddress()).then((tx) => tx.wait());

        const config = await restrictedMaci.getGovernanceConfig();
        expect(config.supportedModes.map((m: bigint) => Number(m))).to.deep.equal([EMode.QV]);

        const startTime = (await getBlockTimestamp(signer)) + 100;
        await expect(
          restrictedMaci.deployPoll(
            {
              startDate: startTime,
              endDate: startTime + duration,
              treeDepths,
              messageBatchSize,
              coordinatorPublicKey: coordinator.publicKey.asContractParam() as { x: BigNumberish; y: BigNumberish },
              mode: EMode.NON_QV,
              policy: r.policyContract,
              initialVoiceCreditProxy: r.constantInitialVoiceCreditProxyContract,
              relayers: [ZeroAddress],
              voteOptions: maxVoteOptions,
              name: "",
              metadata: "",
              options: [],
              optionInfo: [],
              policyType: EPolicy.FreeForAll,
            },
            await signer.getAddress(),
          ),
        ).to.be.revertedWithCustomError(restrictedMaci, "UnsupportedMode");
      });

      it("should deploy with only FreeForAll policy allowed and enforce it", async () => {
        const r = await deployTestContracts({
          initialVoiceCreditBalance,
          stateTreeDepth: STATE_TREE_DEPTH,
          signer,
          initialSupportedModes: ALL_MODES,
          initialAllowedPolicies: [EPolicy.FreeForAll],
        });
        const restrictedMaci = r.maciContract;
        await r.policyContract.setTarget(await restrictedMaci.getAddress()).then((tx) => tx.wait());

        const config = await restrictedMaci.getGovernanceConfig();
        expect(config.allowedPolicies.map((p: bigint) => Number(p))).to.deep.equal([EPolicy.FreeForAll]);

        const startTime = (await getBlockTimestamp(signer)) + 100;
        await expect(
          restrictedMaci.deployPoll(
            {
              startDate: startTime,
              endDate: startTime + duration,
              treeDepths,
              messageBatchSize,
              coordinatorPublicKey: coordinator.publicKey.asContractParam() as { x: BigNumberish; y: BigNumberish },
              mode: EMode.QV,
              policy: r.policyContract,
              initialVoiceCreditProxy: r.constantInitialVoiceCreditProxyContract,
              relayers: [ZeroAddress],
              voteOptions: maxVoteOptions,
              name: "",
              metadata: "",
              options: [],
              optionInfo: [],
              policyType: EPolicy.ERC20,
            },
            await signer.getAddress(),
          ),
        ).to.be.revertedWithCustomError(restrictedMaci, "UnsupportedPolicy");
      });
    });
  });
});
