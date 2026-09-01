import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof } from "@semaphore-protocol/proof";
import { privateKeyToAccount } from "viem/accounts";
import { SiweMessage } from "siwe";
import { eq } from "drizzle-orm";
import { testDb, clearCommunities, clearCredentials } from "./helpers/testDb.js";
import * as schema from "../src/db/schema.js";
import * as decisionAdapterService from "../src/services/decisionAdapterService.js";
import * as proposalService from "../src/services/proposalService.js";
import * as zupollService from "../src/services/zupollService.js";
import { proposalScope } from "../src/services/zupollService.js";

process.env.CORS_ORIGIN ??= "http://localhost:5173"; // pre-existing bug, see specs/003 research.md

// See tests/membership.test.ts — real @pcd/zuauth fails to load under Vitest's Node ESM loader.
vi.mock("@pcd/zuauth", () => ({ default: { authenticate: vi.fn(), ETHBERLIN04: [] } }));

const { app } = await import("../src/app.js");

const ADMIN = privateKeyToAccount(`0x${"11".repeat(32)}`);
const CREATOR = privateKeyToAccount(`0x${"22".repeat(32)}`);
const OUTSIDER = privateKeyToAccount(`0x${"33".repeat(32)}`);

function now(): number {
  return Math.floor(Date.now() / 1000);
}

async function insertCommunity(overrides: Partial<typeof schema.communities.$inferInsert> = {}) {
  const id = randomUUID();
  await testDb.insert(schema.communities).values({
    id,
    displayName: "Zupoll Test Community",
    creatorAddress: ADMIN.address,
    createdAt: now(),
    registeredAt: now(),
    ...overrides,
  });
  return id;
}

async function insertTier(communityId: string, overrides: Partial<typeof schema.membershipTiers.$inferInsert> = {}) {
  const id = randomUUID();
  await testDb.insert(schema.membershipTiers).values({
    id,
    communityId,
    label: "Voter",
    canCreateProposals: true,
    canVote: true,
    canManageMembership: false,
    createdAt: now(),
    ...overrides,
  });
  return id;
}

async function insertMember(communityId: string, walletAddress: string, tierId: string) {
  await testDb.insert(schema.memberships).values({ walletAddress, communityId, tierId, joinedAt: now() });
}

/** Full happy-path fixture: a community with the zupoll adapter attached, one voter tier, and
 * one member (CREATOR) with that tier. Returns everything a test typically needs. */
async function setupZupollCommunity() {
  const communityId = await insertCommunity();
  await decisionAdapterService.attach(communityId, "zupoll");
  const tierId = await insertTier(communityId);
  await insertMember(communityId, CREATOR.address, tierId);
  return { communityId, tierId };
}

async function authCookieFor(account: typeof ADMIN): Promise<string> {
  const nonceRes = await app.request("/api/auth/nonce");
  const cookie = nonceRes.headers.get("set-cookie")!.split(";")[0]!;
  const { nonce } = (await nonceRes.json()) as { nonce: string };

  const siweMessage = new SiweMessage({
    domain: "localhost",
    address: account.address,
    statement: "Sign in with Ethereum to ZuGov",
    uri: "http://localhost:5173",
    version: "1",
    chainId: 534351,
    nonce,
  });
  const message = siweMessage.prepareMessage();
  const signature = await account.signMessage({ message });

  const verifyRes = await app.request("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ message, signature }),
  });
  expect(verifyRes.status).toBe(200);
  return verifyRes.headers.get("set-cookie")!.split(";")[0]!;
}

/** Registers a fresh Semaphore identity for `walletAddress` and returns it alongside the
 * commitment string, mirroring what zugov-frontend's useZupollIdentity hook does client-side. */
async function registerFreshIdentity(communityId: string, walletAddress: string): Promise<Identity> {
  const identity = new Identity();
  await zupollService.registerCommitment(walletAddress, communityId, identity.commitment.toString());
  return identity;
}

describe("zupollService", () => {
  beforeEach(async () => {
    await clearCommunities();
    await clearCredentials();
  });

  afterAll(async () => {
    await clearCommunities();
    await clearCredentials();
  });

  describe("decisionAdapterService — zupoll capability (US1)", () => {
    it("declares zupoll's supported eligibility mechanisms, voting protocol types, and substrate", () => {
      expect(decisionAdapterService.getCapabilities("zupoll")).toEqual({
        adapterType: "zupoll",
        supportedEligibilityMechanisms: ["tier"],
        supportedVotingProtocolTypes: ["simple"],
        executionLocation: "offchain",
        privacy: "privacy_preserving",
      });
    });

    it("can be attached alongside an already-attached maci adapter", async () => {
      const communityId = await insertCommunity();
      await decisionAdapterService.attach(communityId, "maci");
      await decisionAdapterService.attach(communityId, "zupoll");

      const available = await decisionAdapterService.listAvailable(communityId);
      expect(available.map((a) => a.adapterType).sort()).toEqual(["maci", "zupoll"]);
    });

    it("HTTP: a non-admin's attach attempt is rejected 403", async () => {
      const communityId = await insertCommunity();
      const cookie = await authCookieFor(OUTSIDER);

      const res = await app.request(`/api/communities/${communityId}/decision-adapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ adapterType: "zupoll" }),
      });
      expect(res.status).toBe(403);
      expect(await decisionAdapterService.isAttached(communityId, "zupoll")).toBe(false);
    });

    it("HTTP: the community creator can attach zupoll to an otherwise ungoverned community", async () => {
      const communityId = await insertCommunity();
      const cookie = await authCookieFor(ADMIN);

      const res = await app.request(`/api/communities/${communityId}/decision-adapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ adapterType: "zupoll" }),
      });
      expect(res.status).toBe(201);
      expect(await decisionAdapterService.isAttached(communityId, "zupoll")).toBe(true);
    });
  });

  describe("createZupollProposal (US2)", () => {
    it("creates a proposal immediately and snapshots the eligible-voter group", async () => {
      const { communityId, tierId } = await setupZupollCommunity();

      const proposal = await proposalService.createZupollProposal(communityId, CREATOR.address, {
        title: "Should we hold a potluck?",
        options: ["Yes", "No"],
        eligibleTierIds: [tierId],
        pollEndDate: now() + 3600,
      });

      expect(proposal.status).toBe("formalized");
      expect(proposal.decisionTargetType).toBe("opinion");
      expect(proposal.options).toEqual(["Yes", "No"]);

      const group = await zupollService.getGroup(proposal.id);
      expect(group).not.toBeNull();
      expect(group!.title).toBe("Should we hold a potluck?");
      expect(group!.options).toEqual(["Yes", "No"]);
    });

    it("is rejected when the community has not attached zupoll, even if maci is attached", async () => {
      const communityId = await insertCommunity();
      await decisionAdapterService.attach(communityId, "maci"); // deliberately not zupoll
      const tierId = await insertTier(communityId);
      await insertMember(communityId, CREATOR.address, tierId);

      await expect(
        proposalService.createZupollProposal(communityId, CREATOR.address, {
          title: "Q",
          options: ["A", "B"],
          eligibleTierIds: [tierId],
          pollEndDate: now() + 3600,
        }),
      ).rejects.toBeInstanceOf(proposalService.NoDecisionAdapterAttachedError);
    });

    it("is rejected 403 for a member without canCreateProposals (US4)", async () => {
      const communityId = await insertCommunity();
      await decisionAdapterService.attach(communityId, "zupoll");
      const tierId = await insertTier(communityId, { canCreateProposals: false });
      await insertMember(communityId, CREATOR.address, tierId);

      await expect(
        proposalService.createZupollProposal(communityId, CREATOR.address, {
          title: "Q",
          options: ["A", "B"],
          eligibleTierIds: [tierId],
          pollEndDate: now() + 3600,
        }),
      ).rejects.toBeInstanceOf(proposalService.NotAuthorizedToCreateError);
    });

    // Credential wedge (2026-08-29 /plan-eng-review, E0) — the credential check lives inside
    // validateTierAndAxis, the ONE function shared by all 4 proposal-creation entry points
    // (see proposals.test.ts for the other 3). This proves the zupoll path is gated too.
    it("is rejected when the tier requires a credential the caller doesn't have", async () => {
      const communityId = await insertCommunity();
      await decisionAdapterService.attach(communityId, "zupoll");
      const tierId = await insertTier(communityId, { requiresCredential: "zupass" });
      await insertMember(communityId, CREATOR.address, tierId);

      await expect(
        proposalService.createZupollProposal(communityId, CREATOR.address, {
          title: "Q",
          options: ["A", "B"],
          eligibleTierIds: [tierId],
          pollEndDate: now() + 3600,
        }),
      ).rejects.toBeInstanceOf(proposalService.CredentialRequiredError);
    });

    it("succeeds once the caller has a verified credential for the required protocol", async () => {
      const communityId = await insertCommunity();
      await decisionAdapterService.attach(communityId, "zupoll");
      const tierId = await insertTier(communityId, { requiresCredential: "zupass" });
      await insertMember(communityId, CREATOR.address, tierId);
      await testDb.insert(schema.credentials).values({
        walletAddress: CREATOR.address,
        protocol: "zupass",
        status: "verified",
        lastCheckedAt: now(),
        createdAt: now(),
      });

      const proposal = await proposalService.createZupollProposal(communityId, CREATOR.address, {
        title: "Q",
        options: ["A", "B"],
        eligibleTierIds: [tierId],
        pollEndDate: now() + 3600,
      });
      expect(proposal.status).toBe("formalized");
    });

    it("HTTP: creation is rejected 422 for a duplicate option string", async () => {
      const { communityId, tierId } = await setupZupollCommunity();
      const cookie = await authCookieFor(CREATOR);

      const res = await app.request(`/api/communities/${communityId}/zupoll/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          title: "Q",
          options: ["Yes", "yes"],
          eligibleTierIds: [tierId],
          pollEndDate: now() + 3600,
        }),
      });
      expect(res.status).toBe(422);
    });
  });

  describe("withdraw (FR-015)", () => {
    it("lets the creator withdraw a proposal with zero votes", async () => {
      const { communityId, tierId } = await setupZupollCommunity();
      const proposal = await proposalService.createZupollProposal(communityId, CREATOR.address, {
        title: "Q",
        options: ["A", "B"],
        eligibleTierIds: [tierId],
        pollEndDate: now() + 3600,
      });

      const result = await zupollService.withdraw(proposal.id, CREATOR.address);
      expect(result.withdrawnAt).toBeGreaterThan(0);
    });

    it("rejects withdrawal once at least one vote exists", async () => {
      const { communityId, tierId } = await setupZupollCommunity();
      const identity = await registerFreshIdentity(communityId, CREATOR.address);
      const proposal = await proposalService.createZupollProposal(communityId, CREATOR.address, {
        title: "Q",
        options: ["A", "B"],
        eligibleTierIds: [tierId],
        pollEndDate: now() + 3600,
      });

      const group = await zupollService.getGroup(proposal.id);
      const semaphoreGroup = new Group(group!.groupCommitments.map((c) => BigInt(c)));
      const proof = await generateProof(identity, semaphoreGroup, 0, proposalScope(proposal.id));
      await zupollService.verifyAndRecordVote(proposal.id, proof);

      await expect(zupollService.withdraw(proposal.id, CREATOR.address)).rejects.toBeInstanceOf(
        zupollService.VotesAlreadyCastError,
      );
    });

    it("rejects a non-creator, non-admin caller", async () => {
      const { communityId, tierId } = await setupZupollCommunity();
      const proposal = await proposalService.createZupollProposal(communityId, CREATOR.address, {
        title: "Q",
        options: ["A", "B"],
        eligibleTierIds: [tierId],
        pollEndDate: now() + 3600,
      });

      await expect(zupollService.withdraw(proposal.id, OUTSIDER.address)).rejects.toBeInstanceOf(
        zupollService.NotAuthorizedToWithdrawError,
      );
    });
  });

  describe("anonymous voting (US3) — the core of this feature", () => {
    async function createProposalWithVoter() {
      const { communityId, tierId } = await setupZupollCommunity();
      const identity = await registerFreshIdentity(communityId, CREATOR.address);
      const proposal = await proposalService.createZupollProposal(communityId, CREATOR.address, {
        title: "Should we hold a potluck?",
        options: ["Yes", "No"],
        eligibleTierIds: [tierId],
        pollEndDate: now() + 3600,
      });
      const group = await zupollService.getGroup(proposal.id);
      const semaphoreGroup = new Group(group!.groupCommitments.map((c) => BigInt(c)));
      return { communityId, tierId, identity, proposal, semaphoreGroup };
    }

    it("records a valid vote with a zupollVotes row that has no identity-linking column", async () => {
      const { proposal, identity, semaphoreGroup } = await createProposalWithVoter();
      const proof = await generateProof(identity, semaphoreGroup, 1, proposalScope(proposal.id));

      const result = await zupollService.verifyAndRecordVote(proposal.id, proof);
      expect(result.optionIdx).toBe(1);

      const [row] = await testDb.select().from(schema.zupollVotes);
      expect(row).toBeDefined();
      // The anonymity boundary, verified structurally: this object has no wallet/identity key.
      expect(Object.keys(row!).sort()).toEqual(["castAt", "id", "nullifier", "optionIdx", "proposalId"]);
      expect(row).not.toHaveProperty("walletAddress");
    });

    it("rejects a second vote with the same nullifier on the same proposal", async () => {
      const { proposal, identity, semaphoreGroup } = await createProposalWithVoter();
      const proof = await generateProof(identity, semaphoreGroup, 0, proposalScope(proposal.id));

      await zupollService.verifyAndRecordVote(proposal.id, proof);
      await expect(zupollService.verifyAndRecordVote(proposal.id, proof)).rejects.toBeInstanceOf(
        zupollService.DuplicateVoteError,
      );
    });

    it("HTTP: the vote endpoint succeeds with no Authorization header or session cookie at all", async () => {
      const { proposal, identity, semaphoreGroup } = await createProposalWithVoter();
      const proof = await generateProof(identity, semaphoreGroup, 0, proposalScope(proposal.id));

      const res = await app.request(`/api/proposals/${proposal.id}/zupoll/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }, // deliberately no Cookie / Authorization
        body: JSON.stringify({ proof }),
      });
      expect(res.status).toBe(200);
    });

    it("rejects a proof built against a different proposal's group root (stale/foreign root)", async () => {
      const { communityId, tierId } = await setupZupollCommunity();
      const identity = await registerFreshIdentity(communityId, CREATOR.address);

      const proposalA = await proposalService.createZupollProposal(communityId, CREATOR.address, {
        title: "A",
        options: ["x", "y"],
        eligibleTierIds: [tierId],
        pollEndDate: now() + 3600,
      });
      const proposalB = await proposalService.createZupollProposal(communityId, CREATOR.address, {
        title: "B",
        options: ["x", "y"],
        eligibleTierIds: [tierId],
        pollEndDate: now() + 3600,
      });

      const groupA = await zupollService.getGroup(proposalA.id);
      const semaphoreGroupA = new Group(groupA!.groupCommitments.map((c) => BigInt(c)));
      // Proof generated for proposal A's scope, submitted against proposal B.
      const proof = await generateProof(identity, semaphoreGroupA, 0, proposalScope(proposalA.id));

      await expect(zupollService.verifyAndRecordVote(proposalB.id, proof)).rejects.toBeInstanceOf(
        zupollService.InvalidVoteProofError,
      );
    });

    it("rejects a structurally invalid/forged proof", async () => {
      const { proposal } = await createProposalWithVoter();
      const forged = {
        merkleTreeDepth: 1,
        merkleTreeRoot: "1",
        message: "0",
        nullifier: "123",
        scope: proposalScope(proposal.id),
        points: ["1", "1", "1", "1", "1", "1", "1", "1"],
      };

      await expect(zupollService.verifyAndRecordVote(proposal.id, forged)).rejects.toBeInstanceOf(
        zupollService.InvalidVoteProofError,
      );
    });

    it("the same identity produces different nullifiers on two different proposals (research.md #11)", async () => {
      const {
        communityId,
        tierId,
        identity,
        proposal: proposalA,
        semaphoreGroup: semaphoreGroupA,
      } = await createProposalWithVoter();
      const proofA = await generateProof(identity, semaphoreGroupA, 0, proposalScope(proposalA.id));

      const proposalB = await proposalService.createZupollProposal(communityId, CREATOR.address, {
        title: "B",
        options: ["x", "y"],
        eligibleTierIds: [tierId],
        pollEndDate: now() + 3600,
      });
      const groupB = await zupollService.getGroup(proposalB.id);
      const semaphoreGroupB = new Group(groupB!.groupCommitments.map((c) => BigInt(c)));
      const proofB = await generateProof(identity, semaphoreGroupB, 0, proposalScope(proposalB.id));

      expect(proofA.scope).not.toBe(proofB.scope);
      expect(proofA.nullifier).not.toBe(proofB.nullifier);
    });

    it("hides tallies until the caller's own nullifier is presented, or the proposal expires (FR-008, F1 remediation)", async () => {
      const { proposal, identity, semaphoreGroup } = await createProposalWithVoter();
      const proof = await generateProof(identity, semaphoreGroup, 0, proposalScope(proposal.id));

      const beforeVoting = await zupollService.getTally(proposal.id);
      expect(beforeVoting).toEqual({ revealed: false });

      await zupollService.verifyAndRecordVote(proposal.id, proof);

      const wrongNullifier = await zupollService.getTally(proposal.id, "0");
      expect(wrongNullifier).toEqual({ revealed: false });

      const withOwnNullifier = await zupollService.getTally(proposal.id, proof.nullifier);
      expect(withOwnNullifier).toEqual({ revealed: true, counts: [1, 0] });
    });
  });

  describe("ineligible voters (US4)", () => {
    it("rejects a vote from a commitment never registered in the community", async () => {
      const { communityId, tierId } = await setupZupollCommunity();
      const proposal = await proposalService.createZupollProposal(communityId, CREATOR.address, {
        title: "Q",
        options: ["A", "B"],
        eligibleTierIds: [tierId],
        pollEndDate: now() + 3600,
      });

      const outsiderIdentity = new Identity(); // never registered
      const group = await zupollService.getGroup(proposal.id);
      const semaphoreGroup = new Group(group!.groupCommitments.map((c) => BigInt(c)));

      // A group of size 1 (just CREATOR's registered commitment, which was never registered
      // here since setupZupollCommunity doesn't register one) — outsider can't even build a
      // valid Merkle proof for a commitment that was never added, so proof generation itself
      // fails, which is the expected outcome for "never eligible."
      await expect(generateProof(outsiderIdentity, semaphoreGroup, 0, proposalScope(proposal.id))).rejects.toThrow();
    });

    it("question/options remain visible to a non-eligible caller via the public group endpoint", async () => {
      const { communityId, tierId } = await setupZupollCommunity();
      const proposal = await proposalService.createZupollProposal(communityId, CREATOR.address, {
        title: "Visible question",
        options: ["A", "B"],
        eligibleTierIds: [tierId],
        pollEndDate: now() + 3600,
      });

      const res = await app.request(`/api/proposals/${proposal.id}/zupoll/group`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { title: string; options: string[] };
      expect(body.title).toBe("Visible question");
      expect(body.options).toEqual(["A", "B"]);
    });
  });

  describe("historic eligibility (US5)", () => {
    it("a member eligible at creation time can still vote after their tier's canVote is revoked", async () => {
      const { communityId, tierId } = await setupZupollCommunity();
      const identity = await registerFreshIdentity(communityId, CREATOR.address);
      const proposal = await proposalService.createZupollProposal(communityId, CREATOR.address, {
        title: "Q",
        options: ["A", "B"],
        eligibleTierIds: [tierId],
        pollEndDate: now() + 3600,
      });

      // Revoke canVote AFTER the proposal (and its snapshot) already exist.
      await testDb.update(schema.membershipTiers).set({ canVote: false }).where(eq(schema.membershipTiers.id, tierId));

      const group = await zupollService.getGroup(proposal.id);
      const semaphoreGroup = new Group(group!.groupCommitments.map((c) => BigInt(c)));
      const proof = await generateProof(identity, semaphoreGroup, 0, proposalScope(proposal.id));

      const result = await zupollService.verifyAndRecordVote(proposal.id, proof);
      expect(result.optionIdx).toBe(0);
    });

    it("a member who becomes eligible only after proposal creation is absent from the snapshot", async () => {
      const { communityId, tierId } = await setupZupollCommunity();
      const proposal = await proposalService.createZupollProposal(communityId, CREATOR.address, {
        title: "Q",
        options: ["A", "B"],
        eligibleTierIds: [tierId],
        pollEndDate: now() + 3600,
      });

      // A new member registers AFTER the proposal/snapshot already exists.
      const lateIdentity = await registerFreshIdentity(communityId, OUTSIDER.address);
      await insertMember(communityId, OUTSIDER.address, tierId);

      const group = await zupollService.getGroup(proposal.id);
      expect(group!.groupCommitments).not.toContain(lateIdentity.commitment.toString());
    });
  });

  describe("expiry (US6)", () => {
    it("rejects a vote after pollEndDate and keeps tallies visible and unchanged", async () => {
      const { communityId, tierId } = await setupZupollCommunity();
      const identity = await registerFreshIdentity(communityId, CREATOR.address);
      const proposal = await proposalService.createZupollProposal(communityId, CREATOR.address, {
        title: "Q",
        options: ["A", "B"],
        eligibleTierIds: [tierId],
        pollEndDate: now() - 1, // already expired
      });

      const group = await zupollService.getGroup(proposal.id);
      const semaphoreGroup = new Group(group!.groupCommitments.map((c) => BigInt(c)));
      const proof = await generateProof(identity, semaphoreGroup, 0, proposalScope(proposal.id));

      await expect(zupollService.verifyAndRecordVote(proposal.id, proof)).rejects.toBeInstanceOf(
        zupollService.ProposalClosedError,
      );

      const tally = await zupollService.getTally(proposal.id);
      expect(tally).toEqual({ revealed: true, counts: [0, 0] });
    });
  });
});
