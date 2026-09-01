import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { SiweMessage } from "siwe";
import { privateKeyToAccount } from "viem/accounts";
import { eq } from "drizzle-orm";
import { clearCommunities, clearCredentials, testDb } from "./helpers/testDb.js";
import * as schema from "../src/db/schema.js";

process.env.CORS_ORIGIN ??= "http://localhost:5173"; // pre-existing bug, see specs/003 research.md

// See tests/membership.test.ts — real @pcd/zuauth fails to load under Vitest's Node ESM loader;
// mocked here purely to avoid that broken import chain (unrelated to governance-action logic).
vi.mock("@pcd/zuauth", () => ({
  default: {
    authenticate: vi.fn(),
    ETHBERLIN04: [],
  },
}));

const { app } = await import("../src/app.js");

const CREATOR = privateKeyToAccount(`0x${"33".repeat(32)}`);
const SPONSOR = privateKeyToAccount(`0x${"44".repeat(32)}`);
const OUTSIDER = privateKeyToAccount(`0x${"55".repeat(32)}`);

const CREATE_TIER = {
  label: "Creator",
  canCreateProposals: true,
  canVote: true,
  canManageMembership: false,
};
const VOTER_TIER = {
  label: "Voter",
  canCreateProposals: false,
  canVote: true,
  canManageMembership: false,
};
const NO_RIGHTS_TIER = {
  label: "Guest",
  canCreateProposals: false,
  canVote: false,
  canManageMembership: false,
};

// Governance actions (drafts, sponsorship, formalize, vote-eligibility) are purely tier/
// membership bookkeeping — proposalService never touches MACI/governance-config fields
// (formalize just records a caller-supplied pollAddress/pollId; the actual on-chain deploy
// happens elsewhere). Every community in this file has a "maci" decision adapter attached
// (createCommunityWithTiers inserts the row directly — see below) but never a real
// maciGovernanceConfigs row; that decoupling is deliberate, matching decisionAdapterService's
// own design (it tracks which adapters are attached, not each adapter's actual config).
function identityBody(overrides: Record<string, unknown> = {}) {
  return {
    displayName: "Test Governance Community",
    source: "wizard",
    membershipPolicy: "open",
    tierChangesRequireVote: false,
    tiers: [CREATE_TIER],
    defaultTierLabel: "Creator",
    ...overrides,
  };
}

async function authCookieFor(account: typeof CREATOR): Promise<string> {
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

const DRAFT_BODY = {
  title: "Fund the community garden",
  description: "A proposal to fund the community garden project.",
  privacy: "privacy_preserving",
  executionLocation: "onchain",
  votingProtocolType: "simple",
  eligibleTierIds: [] as string[], // filled per-test once tier IDs are known
};

async function createCommunityWithTiers(
  cookie: string,
  tiers: (typeof CREATE_TIER)[] = [CREATE_TIER, VOTER_TIER],
): Promise<{ communityId: string; tierIds: Record<string, string> }> {
  const res = await app.request("/api/communities", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(identityBody({ tiers, defaultTierLabel: tiers[0]!.label })),
  });
  const { community } = (await res.json()) as { community: { id: string } };
  const tiersRes = await app.request(`/api/communities/${community.id}/tiers`);
  const { tiers: created } = (await tiersRes.json()) as { tiers: { id: string; label: string }[] };

  // Governance restructure Phase 1 (2026-08-20) — proposalService now gates creation on at
  // least one decision adapter being attached. Inserted directly rather than going through the
  // real governance-attach flow (which needs a full maciGovernanceConfigs payload this file
  // deliberately doesn't set up — see the file-level comment above).
  await testDb
    .insert(schema.communityDecisionAdapters)
    .values({ communityId: community.id, adapterType: "maci", attachedAt: Math.floor(Date.now() / 1000) });

  // allowJoin defaults to false for newly-created communities (Child C1, /plan-eng-review
  // 2026-08-24) — this file's tests routinely join a second wallet to become an admin/voter, so
  // this helper opts every community it creates into joinable-by-default, matching this file's
  // existing convention of patching test communities directly via testDb rather than a real
  // settings-page round trip (see the decisionAdapters insert above).
  await testDb.update(schema.communities).set({ allowJoin: true }).where(eq(schema.communities.id, community.id));

  return { communityId: community.id, tierIds: Object.fromEntries(created.map((t) => [t.label, t.id])) };
}

async function enableDirectDeployment(cookie: string, communityId: string): Promise<void> {
  await app.request(`/api/communities/${communityId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ directDeploymentEnabled: true }),
  });
}

beforeEach(async () => {
  try {
    await clearCommunities();
    await clearCredentials();
  } catch {
    // db may not be available in unit test runs without TEST_DATABASE_URL
  }
});

afterAll(async () => {
  try {
    await clearCommunities();
    await clearCredentials();
  } catch {}
});

describe("POST /api/communities/:id/proposals (US1, FR-001/FR-002/FR-003)", () => {
  it("returns 401 without authentication", async () => {
    const res = await app.request("/api/communities/0xdead/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(DRAFT_BODY),
    });
    expect(res.status).toBe(401);
  });

  // Governance restructure Phase 1 (2026-08-20) — a community with no decision adapter attached
  // (governance never configured) cannot create a proposal at all, even if the caller's tier
  // otherwise grants canCreateProposals. Deliberately bypasses createCommunityWithTiers (which
  // inserts a communityDecisionAdapters row for every other test in this file) to exercise the
  // gate itself.
  it("returns 403 with no decision adapter attached, even for an otherwise-authorized creator", async () => {
    const cookie = await authCookieFor(CREATOR);
    const res0 = await app.request("/api/communities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(identityBody()),
    });
    const { community } = (await res0.json()) as { community: { id: string; defaultTierId: string } };

    const res = await app.request(`/api/communities/${community.id}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [community.defaultTierId] }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no decision adapter attached/i);
  });

  it("creates a draft with auto-sponsorship when the creator's tier grants the right", async () => {
    const cookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(cookie);

    const res = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { sponsorCount: number; thresholdMet: boolean };
    expect(body.sponsorCount).toBe(1);
    expect(body.thresholdMet).toBe(true); // default cosponsorshipThreshold is 0
  });

  it("returns 403 when the creator's tier lacks canCreateProposals", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    // Manually add SPONSOR as a member on the no-rights tier via a join-request style flow isn't
    // available for a specific tier assignment in this API surface, so we assert directly against
    // a wallet with zero membership at all — the same rejection path (no tier => no permission).
    const sponsorCookie = await authCookieFor(SPONSOR);
    const res = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sponsorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    expect(res.status).toBe(403);
  });

  it("enrolls the creator in a full-permission tier, not the default tier meant for new joiners", async () => {
    const cookie = await authCookieFor(CREATOR);

    // Mirrors the real wizard's default tier set: "Regular" (the default tier assigned to new
    // joiners) lacks canCreateProposals, while a separate "Admin" tier has full rights.
    // The creator must land in "Admin", not "Regular", or they'd be locked out of their own
    // community's governance actions.
    const REGULAR_TIER = {
      label: "Regular",
      canCreateProposals: false,
      canVote: true,
      canManageMembership: false,
    };
    const ADMIN_TIER = { label: "Admin", canCreateProposals: true, canVote: true, canManageMembership: true };

    const res0 = await app.request("/api/communities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(identityBody({ tiers: [REGULAR_TIER, ADMIN_TIER], defaultTierLabel: "Regular" })),
    });
    const { community } = (await res0.json()) as { community: { id: string } };
    await testDb
      .insert(schema.communityDecisionAdapters)
      .values({ communityId: community.id, adapterType: "maci", attachedAt: Math.floor(Date.now() / 1000) });

    const tiersRes = await app.request(`/api/communities/${community.id}/tiers`);
    const { tiers } = (await tiersRes.json()) as { tiers: { id: string; label: string }[] };
    const adminTierId = tiers.find((t) => t.label === "Admin")!.id;

    const res = await app.request(`/api/communities/${community.id}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [adminTierId] }),
    });
    expect(res.status).toBe(201);
  });

  it("returns 422 for a non-executable axis combination", async () => {
    const cookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(cookie);

    const res = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        ...DRAFT_BODY,
        privacy: "public",
        eligibleTierIds: [tierIds["Voter"]],
      }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 when an eligible tier lacks canVote", async () => {
    const cookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(cookie, [CREATE_TIER, NO_RIGHTS_TIER]);

    const res = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Guest"]] }),
    });
    expect(res.status).toBe(422);
  });
});

// Credential wedge (2026-08-29 /plan-eng-review, E0) — the check lives inside
// validateTierAndAxis, the ONE function shared by all 4 proposal-creation entry points
// (createDraft, direct/authorize, direct/confirm, createZupollProposal — see zupoll.test.ts for
// the 4th). This is the exact bug the outside-voice review caught: an earlier wording would have
// left 3 of 4 entry points ungated. These tests prove createDraft, direct/authorize, and
// direct/confirm are all gated identically, not just whichever path was implemented first.
describe("credential gate (E0, requiresCredential)", () => {
  const CREDENTIAL_TIER = {
    label: "Creator",
    canCreateProposals: true,
    canVote: true,
    canManageMembership: false,
    requiresCredential: "zupass" as const,
  };

  // credentialStore keys on the exact-case wallet address session.address carries (no
  // normalization anywhere in that subsystem — see routes/credentials.ts), so this must match
  // CREATOR.address's casing exactly, not a lowercased form.
  async function verifyCredentialFor(walletAddress: string) {
    const now = Math.floor(Date.now() / 1000);
    await testDb.insert(schema.credentials).values({
      walletAddress,
      protocol: "zupass",
      status: "verified",
      lastCheckedAt: now,
      createdAt: now,
    });
  }

  it("returns 403 from createDraft when the creator's tier requires a credential they don't have", async () => {
    const cookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(cookie, [CREDENTIAL_TIER, VOTER_TIER]);

    const res = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/requires a verified credential/i);
  });

  it("allows createDraft once the creator has a verified credential for the required protocol", async () => {
    const cookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(cookie, [CREDENTIAL_TIER, VOTER_TIER]);
    await verifyCredentialFor(CREATOR.address);

    const res = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    expect(res.status).toBe(201);
  });

  it("returns 403 from direct/authorize for the same ungated tier", async () => {
    const cookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(cookie, [CREDENTIAL_TIER, VOTER_TIER]);
    await enableDirectDeployment(cookie, communityId);

    const res = await app.request(`/api/communities/${communityId}/proposals/direct/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/requires a verified credential/i);
  });

  it("allows direct/authorize once the creator has a verified credential", async () => {
    const cookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(cookie, [CREDENTIAL_TIER, VOTER_TIER]);
    await enableDirectDeployment(cookie, communityId);
    await verifyCredentialFor(CREATOR.address);

    const res = await app.request(`/api/communities/${communityId}/proposals/direct/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 from direct/confirm for the same ungated tier", async () => {
    const cookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(cookie, [CREDENTIAL_TIER, VOTER_TIER]);
    await enableDirectDeployment(cookie, communityId);

    const res = await app.request(`/api/communities/${communityId}/proposals/direct/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        ...DRAFT_BODY,
        eligibleTierIds: [tierIds["Voter"]],
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: 1000,
        pollEndDate: 2000,
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/requires a verified credential/i);
  });

  it("allows direct/confirm once the creator has a verified credential", async () => {
    const cookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(cookie, [CREDENTIAL_TIER, VOTER_TIER]);
    await enableDirectDeployment(cookie, communityId);
    await verifyCredentialFor(CREATOR.address);

    const res = await app.request(`/api/communities/${communityId}/proposals/direct/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        ...DRAFT_BODY,
        eligibleTierIds: [tierIds["Voter"]],
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: 1000,
        pollEndDate: 2000,
      }),
    });
    expect(res.status).toBe(201);
  });
});

describe("POST /api/communities/:id/proposals/:actionId/sponsor (US2, FR-004)", () => {
  it("dedupes a repeat sponsor without double-counting", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    // Includes the Creator tier as eligible (not just Voter) so the creator's own re-sponsor call
    // below is a legitimate sponsorship attempt, not one rejected for tier ineligibility — there's
    // no API surface in this test to assign a wallet to a specific non-default tier, so idempotency
    // is exercised via the creator's own membership instead.
    const createRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Creator"], tierIds["Voter"]] }),
    });
    const { proposal } = (await createRes.json()) as { proposal: { id: string } };

    const res1 = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/sponsor`, {
      method: "POST",
      headers: { Cookie: creatorCookie },
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { sponsorCount: number };
    expect(body1.sponsorCount).toBe(1); // already auto-sponsored at creation — no double count

    const res2 = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/sponsor`, {
      method: "POST",
      headers: { Cookie: creatorCookie },
    });
    const body2 = (await res2.json()) as { sponsorCount: number };
    expect(body2.sponsorCount).toBe(1);
  });

  it("returns 403 when the sponsor's tier isn't eligible", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    const createRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    const { proposal } = (await createRes.json()) as { proposal: { id: string } };

    const outsiderCookie = await authCookieFor(OUTSIDER);
    const res = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/sponsor`, {
      method: "POST",
      headers: { Cookie: outsiderCookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/communities/:id/proposals/:actionId/formalize/authorize (US2, FR-007)", () => {
  it("returns 409 when the co-sponsorship threshold isn't met", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    // Set a threshold of 2 (creator alone won't meet it) via PATCH
    await app.request(`/api/communities/${communityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ cosponsorshipThreshold: 2 }),
    });

    const createRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    const { proposal } = (await createRes.json()) as { proposal: { id: string } };

    const res = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/formalize/authorize`, {
      method: "POST",
      headers: { Cookie: creatorCookie },
    });
    expect(res.status).toBe(409);
  });

  it("returns 200 authorized when threshold is 0 (default)", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    const createRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    const { proposal } = (await createRes.json()) as { proposal: { id: string } };

    const res = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/formalize/authorize`, {
      method: "POST",
      headers: { Cookie: creatorCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorized: boolean };
    expect(body.authorized).toBe(true);
  });

  // Security fix (2026-08-23) — this endpoint previously never checked WHO was calling it, only
  // that the proposal's stored creator still had permission. Any authenticated wallet from any
  // community could formalize someone else's proposal once its threshold was met.
  it("returns 403 for an authenticated wallet that is neither the creator nor a community admin", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const outsiderCookie = await authCookieFor(OUTSIDER);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    const createRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    const { proposal } = (await createRes.json()) as { proposal: { id: string } };

    const res = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/formalize/authorize`, {
      method: "POST",
      headers: { Cookie: outsiderCookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/communities/:id/proposals/:actionId/formalize/confirm (US2, FR-008/FR-009)", () => {
  it("formalizes and locks the action when checks pass", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    const createRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    const { proposal } = (await createRes.json()) as { proposal: { id: string } };

    const res = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/formalize/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: 1000,
        pollEndDate: 2000,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proposal: { status: string; pollAddress: string } };
    expect(body.proposal.status).toBe("formalized");
    expect(body.proposal.pollAddress).toBe("0xPoll");
  });

  // Security fix (2026-08-23) — see the sibling test on formalize/authorize above. confirm is
  // the more severe half of this gap: an unrelated wallet could plant an arbitrary pollAddress/
  // txHash onto someone else's community's proposal.
  it("returns 403 for an authenticated wallet that is neither the creator nor a community admin", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const outsiderCookie = await authCookieFor(OUTSIDER);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    const createRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    const { proposal } = (await createRes.json()) as { proposal: { id: string } };

    const res = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/formalize/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: outsiderCookie },
      body: JSON.stringify({
        pollAddress: "0xAttackerPoll",
        pollId: "0",
        txHash: "0xAttackerTx",
        pollStartDate: 1000,
        pollEndDate: 2000,
      }),
    });
    expect(res.status).toBe(403);
  });

  // A community admin (canManageMembership) who isn't the proposal's creator must still be able
  // to formalize -- matches events.ts's assertCanManageEvent precedent (creator OR isAuthorized).
  it("allows a community admin who isn't the proposal's creator to formalize", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const adminCookie = await authCookieFor(SPONSOR);
    // Single admin-permission tier: createCommunityWithTiers enrolls the creator into tiers[0]
    // (the "full-permission" tier, per communityService.createIdentity) AND uses tiers[0] as the
    // default tier a new joiner lands in -- so both CREATOR and SPONSOR end up in this same tier.
    const ADMIN_TIER = { label: "Admin", canCreateProposals: true, canVote: true, canManageMembership: true };
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie, [ADMIN_TIER]);
    await app.request(`/api/communities/${communityId}/join`, { method: "POST", headers: { Cookie: adminCookie } });

    const createRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Admin"]] }),
    });
    const { proposal } = (await createRes.json()) as { proposal: { id: string } };

    const res = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/formalize/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: 1000,
        pollEndDate: 2000,
      }),
    });
    expect(res.status).toBe(200);
  });

  it("persists the poll's option labels (specs/010 US1, FR-001/FR-002)", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    const createRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    const { proposal } = (await createRes.json()) as { proposal: { id: string } };

    const res = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/formalize/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: 1000,
        pollEndDate: 2000,
        options: ["Fund the greenhouse", "Fund the library"],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proposal: { options: string[] | null } };
    expect(body.proposal.options).toEqual(["Fund the greenhouse", "Fund the library"]);
  });
});

describe("GET /api/communities/:id/proposals/:actionId/vote-eligibility (US3, FR-010/FR-011)", () => {
  it("returns not_formalized for a still-draft action", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    const createRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    const { proposal } = (await createRes.json()) as { proposal: { id: string } };

    const res = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/vote-eligibility`, {
      headers: { Cookie: creatorCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { eligible: boolean; reason?: string };
    expect(body.eligible).toBe(false);
    expect(body.reason).toBe("not_formalized");
  });

  it("returns eligible: true for a qualifying member on a formalized action", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    const createRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Creator"]] }),
    });
    const { proposal } = (await createRes.json()) as { proposal: { id: string } };

    await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/formalize/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: Math.floor(Date.now() / 1000),
        pollEndDate: Math.floor(Date.now() / 1000) + 3600,
      }),
    });

    const res = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/vote-eligibility`, {
      headers: { Cookie: creatorCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { eligible: boolean };
    expect(body.eligible).toBe(true);
  });

  it("returns eligible: true for a voting-tier member excluded from the draft-time eligible tiers", async () => {
    // Regression: confirmFormalize used to persist only the tiers picked at draft creation, so a
    // voting-capable member left out of that original selection stayed locked out forever, even
    // though the real on-chain poll (via the deployed eligibility policy) doesn't enforce that
    // narrower set. confirmFormalize now stamps every voting-capable tier at formalization time.
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    const createRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      // Only the Creator tier is selected at draft time — the Voter tier is deliberately excluded.
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Creator"]] }),
    });
    const { proposal } = (await createRes.json()) as { proposal: { id: string } };

    // Enroll SPONSOR on the excluded Voter tier directly — the public /join flow always lands new
    // members on the community's default tier, so there's no API surface to pick a specific tier.
    await testDb.insert(schema.memberships).values({
      walletAddress: SPONSOR.address,
      communityId,
      tierId: tierIds["Voter"]!,
      joinedAt: Math.floor(Date.now() / 1000),
    });

    await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/formalize/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: Math.floor(Date.now() / 1000),
        pollEndDate: Math.floor(Date.now() / 1000) + 3600,
      }),
    });

    const sponsorCookie = await authCookieFor(SPONSOR);
    const res = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/vote-eligibility`, {
      headers: { Cookie: sponsorCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { eligible: boolean };
    expect(body.eligible).toBe(true);
  });

  it("returns poll_closed once the poll's end date has passed", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    const createRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Creator"]] }),
    });
    const { proposal } = (await createRes.json()) as { proposal: { id: string } };

    await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/formalize/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: Math.floor(Date.now() / 1000) - 7200,
        pollEndDate: Math.floor(Date.now() / 1000) - 3600,
      }),
    });

    const res = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/vote-eligibility`, {
      headers: { Cookie: creatorCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { eligible: boolean; reason?: string };
    expect(body.eligible).toBe(false);
    expect(body.reason).toBe("poll_closed");
  });

  it("returns poll_not_started before the poll's start date", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    const createRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Creator"]] }),
    });
    const { proposal } = (await createRes.json()) as { proposal: { id: string } };

    await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/formalize/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: Math.floor(Date.now() / 1000) + 3600,
        pollEndDate: Math.floor(Date.now() / 1000) + 7200,
      }),
    });

    const res = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/vote-eligibility`, {
      headers: { Cookie: creatorCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { eligible: boolean; reason?: string };
    expect(body.eligible).toBe(false);
    expect(body.reason).toBe("poll_not_started");
  });

  it("returns 401 without authentication", async () => {
    const res = await app.request("/api/communities/0xdead/proposals/0xdead/vote-eligibility");
    expect(res.status).toBe(401);
  });
});

// formalize-communities epic, Child H (/plan-eng-review 2026-08-25) — D1 (requireAuth dropped
// from both GET routes), D2 (non-member visibility = eligibleTierIds is a superset of every
// current voting tier, not defaultTierId). No test in this file exercised either plain GET route
// at all before this pass — a genuine pre-existing gap, not something Child H introduced.
describe("GET /api/communities/:id/proposals — visibility (Child H)", () => {
  async function setupProposals(creatorCookie: string) {
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);
    // Unrestricted: eligibleTierIds includes every voting tier this community has (Creator + Voter).
    const unrestrictedRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({
        ...DRAFT_BODY,
        title: "Unrestricted proposal",
        eligibleTierIds: [tierIds["Creator"], tierIds["Voter"]],
      }),
    });
    const unrestricted = (await unrestrictedRes.json()) as { proposal: { id: string } };

    // Restricted: narrowed to just the Voter tier — excludes Creator, the creator's own tier.
    // canView's creator-bypass still makes it visible to CREATOR regardless.
    const restrictedRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({
        ...DRAFT_BODY,
        title: "Restricted proposal",
        eligibleTierIds: [tierIds["Voter"]],
      }),
    });
    const restricted = (await restrictedRes.json()) as { proposal: { id: string } };

    return { communityId, tierIds, unrestrictedId: unrestricted.proposal.id, restrictedId: restricted.proposal.id };
  }

  it("an anonymous caller (no session at all) sees only unrestricted proposals", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, unrestrictedId, restrictedId } = await setupProposals(creatorCookie);

    const res = await app.request(`/api/communities/${communityId}/proposals`);
    expect(res.status).toBe(200);
    const { proposals } = (await res.json()) as { proposals: { id: string }[] };
    const ids = proposals.map((p) => p.id);
    expect(ids).toContain(unrestrictedId);
    expect(ids).not.toContain(restrictedId);
  });

  it("a signed-in non-member sees the same unrestricted-only set as an anonymous caller", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, unrestrictedId, restrictedId } = await setupProposals(creatorCookie);
    const outsiderCookie = await authCookieFor(OUTSIDER);

    const res = await app.request(`/api/communities/${communityId}/proposals`, {
      headers: { Cookie: outsiderCookie },
    });
    expect(res.status).toBe(200);
    const { proposals } = (await res.json()) as { proposals: { id: string }[] };
    const ids = proposals.map((p) => p.id);
    expect(ids).toContain(unrestrictedId);
    expect(ids).not.toContain(restrictedId);
  });

  it("a member whose tier is eligible sees the restricted proposal too", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds, unrestrictedId, restrictedId } = await setupProposals(creatorCookie);
    const voterCookie = await authCookieFor(SPONSOR);
    // Enroll on the "Voter" tier directly — the public /join flow always lands new members on
    // the community's default tier ("Creator" here), so there's no API surface to pick "Voter"
    // specifically (same pattern this file already uses elsewhere).
    await testDb.insert(schema.memberships).values({
      walletAddress: SPONSOR.address,
      communityId,
      tierId: tierIds["Voter"]!,
      joinedAt: Math.floor(Date.now() / 1000),
    });

    const res = await app.request(`/api/communities/${communityId}/proposals`, { headers: { Cookie: voterCookie } });
    expect(res.status).toBe(200);
    const { proposals } = (await res.json()) as { proposals: { id: string }[] };
    const ids = proposals.map((p) => p.id);
    expect(ids).toContain(unrestrictedId);
    expect(ids).toContain(restrictedId);
  });

  it("the creator always sees both, including a proposal restricted away from their own tier", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, unrestrictedId, restrictedId } = await setupProposals(creatorCookie);

    const res = await app.request(`/api/communities/${communityId}/proposals`, { headers: { Cookie: creatorCookie } });
    const { proposals } = (await res.json()) as { proposals: { id: string }[] };
    const ids = proposals.map((p) => p.id);
    expect(ids).toContain(unrestrictedId);
    expect(ids).toContain(restrictedId);
  });

  // Single-proposal access must match the list's gating exactly — both call the same canView().
  describe("GET /api/communities/:id/proposals/:actionId — matches list gating", () => {
    it("anonymous caller can fetch an unrestricted proposal directly by id", async () => {
      const creatorCookie = await authCookieFor(CREATOR);
      const { communityId, unrestrictedId } = await setupProposals(creatorCookie);

      const res = await app.request(`/api/communities/${communityId}/proposals/${unrestrictedId}`);
      expect(res.status).toBe(200);
    });

    it("anonymous caller gets 404 (not a content leak) fetching a restricted proposal directly by id", async () => {
      const creatorCookie = await authCookieFor(CREATOR);
      const { communityId, restrictedId } = await setupProposals(creatorCookie);

      const res = await app.request(`/api/communities/${communityId}/proposals/${restrictedId}`);
      expect(res.status).toBe(404);
    });

    it("a signed-in non-member gets 404 for the same restricted proposal", async () => {
      const creatorCookie = await authCookieFor(CREATOR);
      const { communityId, restrictedId } = await setupProposals(creatorCookie);
      const outsiderCookie = await authCookieFor(OUTSIDER);

      const res = await app.request(`/api/communities/${communityId}/proposals/${restrictedId}`, {
        headers: { Cookie: outsiderCookie },
      });
      expect(res.status).toBe(404);
    });

    it("an eligible member can fetch the restricted proposal directly by id", async () => {
      const creatorCookie = await authCookieFor(CREATOR);
      const { communityId, tierIds, restrictedId } = await setupProposals(creatorCookie);
      const voterCookie = await authCookieFor(SPONSOR);
      await testDb.insert(schema.memberships).values({
        walletAddress: SPONSOR.address,
        communityId,
        tierId: tierIds["Voter"]!,
        joinedAt: Math.floor(Date.now() / 1000),
      });

      const res = await app.request(`/api/communities/${communityId}/proposals/${restrictedId}`, {
        headers: { Cookie: voterCookie },
      });
      expect(res.status).toBe(200);
    });
  });

  // /ship review army (2026-08-26, security specialist) — Array.prototype.every() on an empty
  // array is vacuously true: a community with zero voting-capable tiers must not make every
  // proposal look "unrestricted" to an anonymous caller just because there's no voting tier left
  // to be a superset of.
  it("an anonymous caller sees nothing once every tier's canVote is later flipped off, even for a proposal that was validly restricted when created", async () => {
    // eligibleTierIds must itself be a subset of voting tiers at creation time (IneligibleTiersError),
    // so this precondition can't be reached via the create path directly — it's reached by a
    // community later narrowing every tier's voting rights AFTER a proposal already exists,
    // which the real PATCH /tiers/:tierId route allows unconditionally.
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    const createRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    expect(createRes.status).toBe(201);

    await testDb
      .update(schema.membershipTiers)
      .set({ canVote: false })
      .where(eq(schema.membershipTiers.communityId, communityId));

    const res = await app.request(`/api/communities/${communityId}/proposals`);
    expect(res.status).toBe(200);
    const { proposals } = (await res.json()) as { proposals: { id: string }[] };
    expect(proposals).toEqual([]);
  });
});

describe("POST /api/communities/:id/proposals/direct/authorize (specs/007 US2, FR-004/FR-005/FR-006)", () => {
  it("returns 200 authorized for an eligible member", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);
    await enableDirectDeployment(creatorCookie, communityId);

    const res = await app.request(`/api/communities/${communityId}/proposals/direct/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorized: boolean };
    expect(body.authorized).toBe(true);
  });

  it("returns 403 when the community's directDeploymentEnabled is false", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    const res = await app.request(`/api/communities/${communityId}/proposals/direct/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 when the caller's tier lacks canCreateProposals", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);
    await enableDirectDeployment(creatorCookie, communityId);

    const outsiderCookie = await authCookieFor(OUTSIDER);
    const res = await app.request(`/api/communities/${communityId}/proposals/direct/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: outsiderCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 422 for a non-executable axis combination", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);
    await enableDirectDeployment(creatorCookie, communityId);

    const res = await app.request(`/api/communities/${communityId}/proposals/direct/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, privacy: "public", eligibleTierIds: [tierIds["Voter"]] }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 when an eligible tier lacks canVote", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie, [CREATE_TIER, NO_RIGHTS_TIER]);
    await enableDirectDeployment(creatorCookie, communityId);

    const res = await app.request(`/api/communities/${communityId}/proposals/direct/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Guest"]] }),
    });
    expect(res.status).toBe(422);
  });

  // Governance restructure Phase 2 (2026-08-20) — "person"-type (election) proposal validation.
  // Direct-deploy path only this phase; validated here, at authorize time, before any
  // wallet-signed deploy transaction (Code Quality Finding 1: fail fast, not at tally time).
  describe("person-type (election) options", () => {
    async function setupWithSecondMember(creatorCookie: string) {
      const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);
      await enableDirectDeployment(creatorCookie, communityId);
      await testDb.insert(schema.memberships).values({
        walletAddress: SPONSOR.address,
        communityId,
        tierId: tierIds["Voter"]!,
        joinedAt: Math.floor(Date.now() / 1000),
      });
      return { communityId, tierIds };
    }

    it("returns 422 when optionMemberAddresses is missing", async () => {
      const creatorCookie = await authCookieFor(CREATOR);
      const { communityId, tierIds } = await setupWithSecondMember(creatorCookie);

      const res = await app.request(`/api/communities/${communityId}/proposals/direct/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: creatorCookie },
        body: JSON.stringify({
          ...DRAFT_BODY,
          eligibleTierIds: [tierIds["Voter"]],
          decisionTargetType: "person",
          options: ["Alice", "Bob"],
        }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/optionMemberAddresses is required/i);
    });

    it("returns 422 when optionMemberAddresses length doesn't match options length", async () => {
      const creatorCookie = await authCookieFor(CREATOR);
      const { communityId, tierIds } = await setupWithSecondMember(creatorCookie);

      const res = await app.request(`/api/communities/${communityId}/proposals/direct/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: creatorCookie },
        body: JSON.stringify({
          ...DRAFT_BODY,
          eligibleTierIds: [tierIds["Voter"]],
          decisionTargetType: "person",
          options: ["Alice", "Bob"],
          optionMemberAddresses: [CREATOR.address],
        }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/length must match/i);
    });

    it("returns 422 when an optionMemberAddresses entry is not a real community member", async () => {
      const creatorCookie = await authCookieFor(CREATOR);
      const { communityId, tierIds } = await setupWithSecondMember(creatorCookie);

      const res = await app.request(`/api/communities/${communityId}/proposals/direct/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: creatorCookie },
        body: JSON.stringify({
          ...DRAFT_BODY,
          eligibleTierIds: [tierIds["Voter"]],
          decisionTargetType: "person",
          options: ["Alice", "Bob"],
          optionMemberAddresses: [CREATOR.address, OUTSIDER.address],
        }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/must all be real community members/i);
    });

    it("returns 422 when optionMemberAddresses contains duplicate addresses", async () => {
      const creatorCookie = await authCookieFor(CREATOR);
      const { communityId, tierIds } = await setupWithSecondMember(creatorCookie);

      const res = await app.request(`/api/communities/${communityId}/proposals/direct/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: creatorCookie },
        body: JSON.stringify({
          ...DRAFT_BODY,
          eligibleTierIds: [tierIds["Voter"]],
          decisionTargetType: "person",
          options: ["Alice", "Bob"],
          optionMemberAddresses: [CREATOR.address, CREATOR.address],
        }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/duplicate addresses/i);
    });

    it("matches a member address case-insensitively", async () => {
      const creatorCookie = await authCookieFor(CREATOR);
      const { communityId, tierIds } = await setupWithSecondMember(creatorCookie);

      const res = await app.request(`/api/communities/${communityId}/proposals/direct/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: creatorCookie },
        body: JSON.stringify({
          ...DRAFT_BODY,
          eligibleTierIds: [tierIds["Voter"]],
          decisionTargetType: "person",
          options: ["Alice", "Bob"],
          optionMemberAddresses: [CREATOR.address.toUpperCase(), SPONSOR.address.toLowerCase()],
        }),
      });
      expect(res.status).toBe(200);
    });

    it("returns 200 for a valid person-type election with real, distinct member addresses", async () => {
      const creatorCookie = await authCookieFor(CREATOR);
      const { communityId, tierIds } = await setupWithSecondMember(creatorCookie);

      const res = await app.request(`/api/communities/${communityId}/proposals/direct/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: creatorCookie },
        body: JSON.stringify({
          ...DRAFT_BODY,
          eligibleTierIds: [tierIds["Voter"]],
          decisionTargetType: "person",
          options: ["Alice", "Bob"],
          optionMemberAddresses: [CREATOR.address, SPONSOR.address],
        }),
      });
      expect(res.status).toBe(200);
    });

    it("returns 422 when optionMemberAddresses is sent for a non-person-type proposal", async () => {
      const creatorCookie = await authCookieFor(CREATOR);
      const { communityId, tierIds } = await setupWithSecondMember(creatorCookie);

      const res = await app.request(`/api/communities/${communityId}/proposals/direct/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: creatorCookie },
        body: JSON.stringify({
          ...DRAFT_BODY,
          eligibleTierIds: [tierIds["Voter"]],
          options: ["Alice", "Bob"],
          optionMemberAddresses: [CREATOR.address, SPONSOR.address],
        }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/only valid for person-type/i);
    });
  });
});

describe("POST /api/communities/:id/proposals/direct/confirm (specs/007 US2, FR-004/FR-007/FR-010)", () => {
  it("inserts a formalized, direct-path governance action with no sponsor row", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);
    await enableDirectDeployment(creatorCookie, communityId);

    const confirmRes = await app.request(`/api/communities/${communityId}/proposals/direct/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({
        ...DRAFT_BODY,
        eligibleTierIds: [tierIds["Voter"]],
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: 1000,
        pollEndDate: 2000,
      }),
    });
    expect(confirmRes.status).toBe(201);
    const { proposal } = (await confirmRes.json()) as {
      proposal: { id: string; status: string; creationPath: string; pollAddress: string };
    };
    expect(proposal.status).toBe("formalized");
    expect(proposal.creationPath).toBe("direct");
    expect(proposal.pollAddress).toBe("0xPoll");

    const getRes = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}`, {
      headers: { Cookie: creatorCookie },
    });
    const getBody = (await getRes.json()) as { sponsorCount: number };
    expect(getBody.sponsorCount).toBe(0);
  });

  it("persists the poll's option labels (specs/010 US1, FR-001/FR-002)", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);
    await enableDirectDeployment(creatorCookie, communityId);

    const confirmRes = await app.request(`/api/communities/${communityId}/proposals/direct/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({
        ...DRAFT_BODY,
        eligibleTierIds: [tierIds["Voter"]],
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: 1000,
        pollEndDate: 2000,
        options: ["Yes", "No"],
      }),
    });
    expect(confirmRes.status).toBe(201);
    const { proposal } = (await confirmRes.json()) as { proposal: { options: string[] | null } };
    expect(proposal.options).toEqual(["Yes", "No"]);
  });

  // Governance restructure Phase 2 (2026-08-20) — outside-voice-caught regression: the direct
  // path's insert call never set decisionTargetType, so a submitted value silently rode the DB
  // default ("policy") instead of persisting.
  it("persists the submitted decisionTargetType instead of silently defaulting to policy", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);
    await enableDirectDeployment(creatorCookie, communityId);

    const confirmRes = await app.request(`/api/communities/${communityId}/proposals/direct/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({
        ...DRAFT_BODY,
        eligibleTierIds: [tierIds["Voter"]],
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: 1000,
        pollEndDate: 2000,
        decisionTargetType: "opinion",
      }),
    });
    expect(confirmRes.status).toBe(201);
    const { proposal } = (await confirmRes.json()) as { proposal: { decisionTargetType: string } };
    expect(proposal.decisionTargetType).toBe("opinion");
  });

  it("defaults decisionTargetType to policy when omitted", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);
    await enableDirectDeployment(creatorCookie, communityId);

    const confirmRes = await app.request(`/api/communities/${communityId}/proposals/direct/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({
        ...DRAFT_BODY,
        eligibleTierIds: [tierIds["Voter"]],
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: 1000,
        pollEndDate: 2000,
      }),
    });
    expect(confirmRes.status).toBe(201);
    const { proposal } = (await confirmRes.json()) as { proposal: { decisionTargetType: string } };
    expect(proposal.decisionTargetType).toBe("policy");
  });

  it("persists optionMemberAddresses for a valid person-type election", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);
    await enableDirectDeployment(creatorCookie, communityId);
    await testDb.insert(schema.memberships).values({
      walletAddress: SPONSOR.address,
      communityId,
      tierId: tierIds["Voter"]!,
      joinedAt: Math.floor(Date.now() / 1000),
    });

    const confirmRes = await app.request(`/api/communities/${communityId}/proposals/direct/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({
        ...DRAFT_BODY,
        eligibleTierIds: [tierIds["Voter"]],
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: 1000,
        pollEndDate: 2000,
        decisionTargetType: "person",
        options: ["Alice", "Bob"],
        optionMemberAddresses: [CREATOR.address, SPONSOR.address],
      }),
    });
    expect(confirmRes.status).toBe(201);
    const { proposal } = (await confirmRes.json()) as {
      proposal: { decisionTargetType: string; optionMemberAddresses: string[] | null };
    };
    expect(proposal.decisionTargetType).toBe("person");
    expect(proposal.optionMemberAddresses).toEqual([CREATOR.address, SPONSOR.address]);
  });

  it("returns 403 and leaves no record when directDeploymentEnabled is false", async () => {
    const creatorCookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(creatorCookie);

    const res = await app.request(`/api/communities/${communityId}/proposals/direct/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: creatorCookie },
      body: JSON.stringify({
        ...DRAFT_BODY,
        eligibleTierIds: [tierIds["Voter"]],
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: 1000,
        pollEndDate: 2000,
      }),
    });
    expect(res.status).toBe(403);

    const listRes = await app.request(`/api/communities/${communityId}/proposals`, {
      headers: { Cookie: creatorCookie },
    });
    const { proposals } = (await listRes.json()) as { proposals: unknown[] };
    expect(proposals).toHaveLength(0);
  });
});

describe("Draft/direct mutual exclusion (specs/007 US3, FR-003/FR-008/FR-009)", () => {
  it("still creates a draft normally when directDeploymentEnabled is false (regression)", async () => {
    const cookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(cookie);

    const res = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { proposal: { status: string }; sponsorCount: number };
    expect(body.proposal.status).toBe("draft");
    expect(body.sponsorCount).toBe(1);
  });

  it("returns 403 for draft creation once directDeploymentEnabled is true", async () => {
    const cookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(cookie);
    await enableDirectDeployment(cookie, communityId);

    const res = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 for direct/authorize and direct/confirm when directDeploymentEnabled is false", async () => {
    const cookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(cookie);

    const authRes = await app.request(`/api/communities/${communityId}/proposals/direct/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    expect(authRes.status).toBe(403);

    const confirmRes = await app.request(`/api/communities/${communityId}/proposals/direct/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        ...DRAFT_BODY,
        eligibleTierIds: [tierIds["Voter"]],
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: 1000,
        pollEndDate: 2000,
      }),
    });
    expect(confirmRes.status).toBe(403);
  });

  it("lets a draft created before the toggle still formalize normally after it's flipped", async () => {
    const cookie = await authCookieFor(CREATOR);
    const { communityId, tierIds } = await createCommunityWithTiers(cookie);

    const createRes = await app.request(`/api/communities/${communityId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ ...DRAFT_BODY, eligibleTierIds: [tierIds["Voter"]] }),
    });
    const { proposal } = (await createRes.json()) as { proposal: { id: string } };

    // Flip the toggle after the draft already exists — must not retroactively affect it (FR-008).
    await enableDirectDeployment(cookie, communityId);

    const authorizeRes = await app.request(
      `/api/communities/${communityId}/proposals/${proposal.id}/formalize/authorize`,
      { method: "POST", headers: { Cookie: cookie } },
    );
    expect(authorizeRes.status).toBe(200);

    const confirmRes = await app.request(`/api/communities/${communityId}/proposals/${proposal.id}/formalize/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        pollAddress: "0xPoll",
        pollId: "0",
        txHash: "0xTx",
        pollStartDate: 1000,
        pollEndDate: 2000,
      }),
    });
    expect(confirmRes.status).toBe(200);
    const body = (await confirmRes.json()) as { proposal: { status: string } };
    expect(body.proposal.status).toBe("formalized");
  });
});
