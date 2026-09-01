import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { testDb, clearCommunities, clearCredentials } from "./helpers/testDb.js";
import * as schema from "../src/db/schema.js";
import {
  listMembersByAddresses,
  resolveViewerContextsForCommunities,
  hasRequiredCredential,
} from "../src/services/membershipService.js";

const getCredentialMock = vi.fn();
vi.mock("../src/services/identity/credentialStore.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/identity/credentialStore.js")>(
    "../src/services/identity/credentialStore.js",
  );
  return {
    ...actual,
    getCredential: (...args: unknown[]) => getCredentialMock(...args),
  };
});

const MEMBER_A = "0x1111111111111111111111111111111111111a";
const MEMBER_B = "0x2222222222222222222222222222222222222b";
const NON_MEMBER = "0x3333333333333333333333333333333333333c";

async function insertCommunity() {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await testDb.insert(schema.communities).values({
    id,
    displayName: "listMembersByAddresses Test Community",
    creatorAddress: "0x0000000000000000000000000000000000dead",
    createdAt: now,
    registeredAt: now,
  });
  return id;
}

async function insertTierAndMember(communityId: string, walletAddress: string) {
  const tierId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await testDb.insert(schema.membershipTiers).values({
    id: tierId,
    communityId,
    label: "Member",
    canCreateProposals: false,
    canVote: true,
    canManageMembership: false,
    createdAt: now,
  });
  await testDb.insert(schema.memberships).values({ walletAddress, communityId, tierId, joinedAt: now });
}

describe("membershipService.listMembersByAddresses", () => {
  beforeEach(async () => {
    await clearCommunities();
  });

  afterAll(async () => {
    await clearCommunities();
  });

  it("returns [] for an empty input array (no query issued)", async () => {
    const communityId = await insertCommunity();
    expect(await listMembersByAddresses(communityId, [])).toEqual([]);
  });

  it("returns every address that is a real member", async () => {
    const communityId = await insertCommunity();
    await insertTierAndMember(communityId, MEMBER_A);
    await insertTierAndMember(communityId, MEMBER_B);

    const found = await listMembersByAddresses(communityId, [MEMBER_A, MEMBER_B]);
    expect(new Set(found)).toEqual(new Set([MEMBER_A.toLowerCase(), MEMBER_B.toLowerCase()]));
  });

  it("returns only the subset that are real members, silently omitting non-members", async () => {
    const communityId = await insertCommunity();
    await insertTierAndMember(communityId, MEMBER_A);

    const found = await listMembersByAddresses(communityId, [MEMBER_A, NON_MEMBER]);
    expect(found).toEqual([MEMBER_A.toLowerCase()]);
  });

  it("matches case-insensitively", async () => {
    const communityId = await insertCommunity();
    await insertTierAndMember(communityId, MEMBER_A.toLowerCase());

    const found = await listMembersByAddresses(communityId, [MEMBER_A.toUpperCase()]);
    expect(found).toEqual([MEMBER_A.toLowerCase()]);
  });

  it("is scoped per community — a member of one community doesn't match a lookup in another", async () => {
    const communityId = await insertCommunity();
    const otherCommunityId = await insertCommunity();
    await insertTierAndMember(otherCommunityId, MEMBER_A);

    expect(await listMembersByAddresses(communityId, [MEMBER_A])).toEqual([]);
  });
});

// Events expansion (/plan-eng-review 2026-08-26, D1a, outside-voice fix) — batched viewer-context
// resolution for the global events feed, exactly 2 queries total regardless of N communities.
describe("membershipService.resolveViewerContextsForCommunities", () => {
  beforeEach(async () => {
    await clearCommunities();
  });

  afterAll(async () => {
    await clearCommunities();
  });

  const VIEWER = "0x4444444444444444444444444444444444444d";

  async function insertCommunityWithCreator(creatorAddress: string) {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await testDb.insert(schema.communities).values({
      id,
      displayName: "resolveViewerContextsForCommunities Test Community",
      creatorAddress,
      createdAt: now,
      registeredAt: now,
    });
    return id;
  }

  it("returns null for every community when viewerAddress is undefined", async () => {
    const communityId = await insertCommunity();
    const result = await resolveViewerContextsForCommunities([communityId], undefined);
    expect(result.get(communityId)).toBeNull();
  });

  it("returns an empty map and fires no query for an empty communityIds array", async () => {
    const result = await resolveViewerContextsForCommunities([], VIEWER);
    expect(result.size).toBe(0);
  });

  it("resolves a creator, a plain member, and a non-member across 3 distinct communities in one batched call", async () => {
    const createdCommunityId = await insertCommunityWithCreator(VIEWER);
    const memberCommunityId = await insertCommunity();
    await insertTierAndMember(memberCommunityId, VIEWER);
    const nonMemberCommunityId = await insertCommunity();

    const result = await resolveViewerContextsForCommunities(
      [createdCommunityId, memberCommunityId, nonMemberCommunityId],
      VIEWER,
    );

    expect(result.get(createdCommunityId)?.isAdmin).toBe(true);
    expect(result.get(memberCommunityId)?.isAdmin).toBe(false);
    expect(result.get(memberCommunityId)?.tier).not.toBeNull();
    expect(result.get(nonMemberCommunityId)?.isAdmin).toBe(false);
    expect(result.get(nonMemberCommunityId)?.tier).toBeNull();
  });

  it("marks isAdmin via the canManageMembership tier path, not just the creator path", async () => {
    const communityId = await insertCommunity();
    const tierId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await testDb.insert(schema.membershipTiers).values({
      id: tierId,
      communityId,
      label: "Admin",
      canCreateProposals: true,
      canVote: true,
      canManageMembership: true,
      createdAt: now,
    });
    await testDb.insert(schema.memberships).values({ walletAddress: VIEWER, communityId, tierId, joinedAt: now });

    const result = await resolveViewerContextsForCommunities([communityId], VIEWER);
    expect(result.get(communityId)?.isAdmin).toBe(true);
  });
});

// Credential wedge (2026-08-29 /plan-eng-review, E0) — hasRequiredCredential ships OFF by
// default (requiresCredential: null on every existing tier) and fails closed on any lookup error.
describe("membershipService.hasRequiredCredential", () => {
  const WALLET = "0x4444444444444444444444444444444444444d";

  beforeEach(async () => {
    await clearCommunities();
    await clearCredentials();
    // Default: delegate to the real, DB-backed getCredential — only the "fails closed" test
    // below overrides this with a rejection.
    const actual = await vi.importActual<typeof import("../src/services/identity/credentialStore.js")>(
      "../src/services/identity/credentialStore.js",
    );
    getCredentialMock.mockImplementation((...args: Parameters<typeof actual.getCredential>) =>
      actual.getCredential(...args),
    );
  });

  afterAll(async () => {
    await clearCommunities();
    await clearCredentials();
    vi.restoreAllMocks();
  });

  async function insertCommunityWithTier(requiresCredential: "zupass" | "zkid" | null) {
    const communityId = randomUUID();
    const tierId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await testDb.insert(schema.communities).values({
      id: communityId,
      displayName: "hasRequiredCredential Test Community",
      creatorAddress: "0x0000000000000000000000000000000000dead",
      createdAt: now,
      registeredAt: now,
    });
    await testDb.insert(schema.membershipTiers).values({
      id: tierId,
      communityId,
      label: "Member",
      canCreateProposals: true,
      canVote: true,
      canManageMembership: false,
      requiresCredential,
      createdAt: now,
    });
    await testDb.insert(schema.memberships).values({ walletAddress: WALLET, communityId, tierId, joinedAt: now });
    return communityId;
  }

  it("returns true (no gate) when the tier's requiresCredential is null", async () => {
    const communityId = await insertCommunityWithTier(null);
    expect(await hasRequiredCredential(communityId, WALLET)).toBe(true);
  });

  it("returns true when the tier requires a credential and the wallet has a verified one", async () => {
    const communityId = await insertCommunityWithTier("zupass");
    const now = Math.floor(Date.now() / 1000);
    await testDb.insert(schema.credentials).values({
      walletAddress: WALLET,
      protocol: "zupass",
      status: "verified",
      lastCheckedAt: now,
      createdAt: now,
    });
    expect(await hasRequiredCredential(communityId, WALLET)).toBe(true);
  });

  it("returns false when the tier requires a credential and no row exists for the wallet", async () => {
    const communityId = await insertCommunityWithTier("zupass");
    expect(await hasRequiredCredential(communityId, WALLET)).toBe(false);
  });

  it("returns false when the stored credential status is unverified or expired, not just missing", async () => {
    const communityId = await insertCommunityWithTier("zupass");
    const now = Math.floor(Date.now() / 1000);
    await testDb.insert(schema.credentials).values({
      walletAddress: WALLET,
      protocol: "zupass",
      status: "expired",
      lastCheckedAt: now,
      createdAt: now,
    });
    expect(await hasRequiredCredential(communityId, WALLET)).toBe(false);
  });

  it("fails closed (returns false) when the credential lookup throws", async () => {
    const communityId = await insertCommunityWithTier("zupass");
    getCredentialMock.mockRejectedValue(new Error("DB connection lost"));
    expect(await hasRequiredCredential(communityId, WALLET)).toBe(false);
  });

  it("returns true for a wallet with no membership row at all (getMemberTier returns null)", async () => {
    const communityId = await insertCommunityWithTier("zupass");
    const NON_MEMBER = "0x5555555555555555555555555555555555555e";
    expect(await hasRequiredCredential(communityId, NON_MEMBER)).toBe(true);
  });
});
