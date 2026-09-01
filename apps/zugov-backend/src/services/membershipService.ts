import { randomUUID } from "node:crypto";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  communities,
  memberships,
  membershipTiers,
  joinRequests,
  eligibilityRules,
  unionMemberships,
  type MembershipTier,
} from "../db/schema.js";
import type { TierBody } from "../validators/membershipSchema.js";
import { evaluateEligibilityAcrossUnion } from "./eligibilityService.js";
import { listAvailable as listAvailableDecisionAdapters } from "./decisionAdapterService.js";
import { getCredential } from "./identity/credentialStore.js";
import type { Protocol } from "./identity/IdentityProvider.js";

export class TierChangesRequireVoteError extends Error {
  constructor() {
    super("This community's tier changes require a community vote, which is not yet available");
  }
}

export class TierInUseError extends Error {
  constructor() {
    super(
      "Cannot delete a tier that has members assigned, is the community's default tier, or is targeted by an eligibility rule",
    );
  }
}

export class NotEligibleError extends Error {
  constructor(reason?: string) {
    super(reason ?? "Does not meet this community's eligibility requirements");
  }
}

export class DuplicateJoinError extends Error {
  constructor() {
    super("Already a member or already have a pending request for this community");
  }
}

// Distinct from NotEligibleError: allowJoin gates whether joining is possible AT ALL (independent
// of eligibility rules), so a caller needs to tell "you don't meet the eligibility criteria" apart
// from "this community isn't accepting members right now" — different messages, different next
// steps for the user.
export class JoinNotAllowedError extends Error {
  constructor() {
    super("This community is not currently accepting new members");
  }
}

export class RequestNotFoundError extends Error {
  constructor() {
    super("Join request not found or already resolved");
  }
}

// formalize-communities epic, Child F (/plan-eng-review 2026-08-25, D1) — the creator's
// isAuthorized() grant comes from communities.creatorAddress, independent of any memberships row,
// so leaving would silently strip their tier permissions (canVote/canCreateProposals/etc, all
// gated through hasTierPermission's memberships⋈membershipTiers join) while they keep settings
// authority — a confusing half-state, not a real "left" state. A non-creator admin doesn't need
// this carve-out: their isAuthorized() grant comes ONLY from that same join, so leaving revokes
// their admin authority fully and consistently.
export class CreatorCannotLeaveError extends Error {
  constructor() {
    super("The community's creator cannot leave it");
  }
}

// D3 — deliberately NOT communities.governanceConfigured, which reflects only whether a
// maciGovernanceConfigs row exists. Since the governance restructure, a community's governance is
// a menu of independently-attachable decision adapters (communityDecisionAdapters); zupoll attaches
// with zero dependency on maciGovernanceConfigs, so governanceConfigured would read false for a
// zupoll-governed community and incorrectly allow Leave.
export class CommunityHasGovernanceError extends Error {
  constructor() {
    super("Leaving isn't available for communities with governance attached yet");
  }
}

export class NotAMemberError extends Error {
  constructor() {
    super("Not a member of this community");
  }
}

/**
 * Creator/owner (Community.creatorAddress) always has this authority, regardless of tier
 * configuration; a member holding a tier with canManageMembership: true also has it.
 * Clarifications, spec.md FR-008.
 */
export async function isAuthorized(communityId: string, walletAddress: string): Promise<boolean> {
  const [community] = await db
    .select({ creatorAddress: communities.creatorAddress })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  if (!community) return false;
  if (community.creatorAddress.toLowerCase() === walletAddress.toLowerCase()) return true;

  const rows = await db
    .select({ canManageMembership: membershipTiers.canManageMembership })
    .from(memberships)
    .innerJoin(membershipTiers, eq(memberships.tierId, membershipTiers.id))
    .where(and(eq(memberships.walletAddress, walletAddress), eq(memberships.communityId, communityId)))
    .limit(1);

  return rows[0]?.canManageMembership ?? false;
}

// Union-as-community merge (2026-08-28 /plan-eng-review, D3/D10) — a union's "members" are OTHER
// COMMUNITIES (unionMemberships), not wallets, so isAuthorized() on the union's own community
// row (which only ever recognizes its creator + tier holders, and unions deliberately get no
// creator tier — see communityService.createCommunityRow()'s skipCreatorEnrollment) can't be the
// authority check for posting a union's events/proposals/discussions. Matches the union's real,
// already-shipped authority model instead (routes/unions.ts's invite/leave: any ACTIVE member
// community's admin has real authority) — a wallet may post the union's content if it's
// isAuthorized() on any community with an active unionMemberships row for this union. The
// founding community qualifies immediately (routes/unions.ts's POST / already requires the
// creator be isAuthorized() on foundingCommunityId, which becomes an active row at creation), so
// no separate creator-specific check is needed.
export async function isAuthorizedForUnionContent(unionId: string, walletAddress: string): Promise<boolean> {
  const activeMembers = await db
    .select({ communityId: unionMemberships.communityId })
    .from(unionMemberships)
    .where(and(eq(unionMemberships.unionId, unionId), eq(unionMemberships.status, "active")));

  for (const { communityId } of activeMembers) {
    if (await isAuthorized(communityId, walletAddress)) return true;
  }
  return false;
}

// Union-as-community merge (2026-08-28, D10) — the single composition point routes/events.ts
// and discussionService.ts both call, instead of duplicating the type-branch in each. Proposals
// deliberately don't need this: proposalService.createProposal() already checks
// isAttached(communityId, decisionAdapterType) before it ever reaches a tier-permission check,
// and a union can never have a decision adapter attached (see communityService.attachGovernance
// and routes/zupoll.ts's decision-adapters route, both guarded) — so proposal creation is
// already, correctly, unreachable for a union via that pre-existing check, with no new branch
// needed here.
export async function canCreateCommunityContent(
  communityId: string,
  walletAddress: string,
  permission: "canCreateEvents" | "canPostDiscussions",
): Promise<boolean> {
  const [community] = await db
    .select({ type: communities.type })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  if (community?.type === "union") {
    return isAuthorizedForUnionContent(communityId, walletAddress);
  }
  return hasTierPermission(communityId, walletAddress, permission);
}

/**
 * Reads a member's current tier and checks a single permission flag on it — the same join
 * shape as isAuthorized's canManageMembership check, parameterized over which column to read.
 */
export async function hasTierPermission(
  communityId: string,
  walletAddress: string,
  permission: "canCreateProposals" | "canVote" | "canCreateEvents" | "canPostDiscussions",
): Promise<boolean> {
  const rows = await db
    .select({
      canCreateProposals: membershipTiers.canCreateProposals,
      canVote: membershipTiers.canVote,
      canCreateEvents: membershipTiers.canCreateEvents,
      canPostDiscussions: membershipTiers.canPostDiscussions,
    })
    .from(memberships)
    .innerJoin(membershipTiers, eq(memberships.tierId, membershipTiers.id))
    .where(and(eq(memberships.walletAddress, walletAddress), eq(memberships.communityId, communityId)))
    .limit(1);

  return rows[0]?.[permission] ?? false;
}

// formalize-communities epic, Child I (/plan-eng-review 2026-08-25, D3) — extracted from
// proposalService.ts's private getMemberTier, which needed this exact join shape for its own
// canView()/sponsor()/checkVoteEligibility(). Events' new canView() needs the identical lookup, so
// this moved here (the other membership-lookup functions already live in this file) rather than
// being copy-pasted a second time.
export async function getMemberTier(
  communityId: string,
  walletAddress: string,
): Promise<{ tierId: string; canVote: boolean; requiresCredential: Protocol | null } | null> {
  const [row] = await db
    .select({
      tierId: memberships.tierId,
      canVote: membershipTiers.canVote,
      requiresCredential: membershipTiers.requiresCredential,
    })
    .from(memberships)
    .innerJoin(membershipTiers, eq(memberships.tierId, membershipTiers.id))
    .where(and(eq(memberships.walletAddress, walletAddress), eq(memberships.communityId, communityId)))
    .limit(1);
  return row ?? null;
}

// Credential wedge (2026-08-29 /plan-eng-review, E0) — checks System 3 (identity/credentials, an
// already-built, already-working verify-and-store system) against a tier's requiresCredential
// flag, which defaults null (no gate) on every existing tier. Fails closed: a lookup error blocks
// rather than silently permits, matching this app's standard auth-check posture. Called from
// proposalService.ts's validateTierAndAxis — the single function shared by all 4 proposal-creation
// entry points (createDraft, authorizeDirect, confirmDirect, createZupollProposal) — so the gate
// can't be bypassed by any one of them the way a per-entry-point check could have been.
export async function hasRequiredCredential(communityId: string, walletAddress: string): Promise<boolean> {
  const tier = await getMemberTier(communityId, walletAddress);
  if (!tier?.requiresCredential) return true;

  try {
    const credential = await getCredential(walletAddress, tier.requiresCredential);
    return credential?.status === "verified";
  } catch {
    return false;
  }
}

// formalize-communities epic, Child J (/plan-eng-review 2026-08-26, D6) — extracted from
// eventService.ts, which needed this exact shape for its own canView()/list(). Both functions are
// generic over {communityId, creatorAddress, eligibleTierIds}, nothing Event-specific, and
// discussionService.ts needs the identical logic — moved here rather than copy-pasted a third
// time (also see serializeEligibleTierIds/deserializeEligibleTierIds below for the same reasoning
// applied to the null-vs-"null" serialization trap).
export interface ViewerContext {
  viewerAddress: string;
  isAdmin: boolean;
  tier: { tierId: string; canVote: boolean } | null;
}

/** isAuthorized/getMemberTier are loop-invariant for a single list() call (same communityId +
 * viewerAddress for every row) — resolve once, reuse across every row's canViewRestricted() call,
 * instead of a naive per-row lookup (/plan-eng-review 2026-08-25 outside-voice finding). */
export async function resolveViewerContext(
  communityId: string,
  viewerAddress: string | undefined,
): Promise<ViewerContext | null> {
  if (!viewerAddress) return null;
  const [isAdmin, tier] = await Promise.all([
    isAuthorized(communityId, viewerAddress),
    getMemberTier(communityId, viewerAddress),
  ]);
  return { viewerAddress, isAdmin, tier };
}

// Creator/author OR admin bypasses tier restriction (Child I, D1/D2) — assertCanManageEvent-style
// resources already grant admins unconditional authority over items they didn't create, so
// without this bypass an admin could out-manage what they can't even see. `ownerAddress` is taken
// explicitly rather than read off a fixed field name (events use `creatorAddress`, discussions use
// `authorAddress` — this stays agnostic to either).
export function canViewRestricted(
  item: { eligibleTierIds: string | null },
  ownerAddress: string,
  ctx: ViewerContext | null,
): boolean {
  if (item.eligibleTierIds === null) return true;
  if (!ctx) return false;
  if (ownerAddress.toLowerCase() === ctx.viewerAddress.toLowerCase()) return true;
  if (ctx.isAdmin) return true;
  return ctx.tier ? (JSON.parse(item.eligibleTierIds) as string[]).includes(ctx.tier.tierId) : false;
}

/** Explicit null vs JSON.stringify(null) (which would insert the string "null", not SQL NULL, and
 * silently break canViewRestricted's `=== null` check) — the trap proposals' own insert paths
 * don't have to dodge because that column is NOT NULL and always populated. */
export function serializeEligibleTierIds(eligibleTierIds: string[] | null | undefined): string | null {
  return eligibleTierIds ? JSON.stringify(eligibleTierIds) : null;
}

export function deserializeEligibleTierIds<T extends { eligibleTierIds: string | null }>(
  row: T,
): Omit<T, "eligibleTierIds"> & { eligibleTierIds: string[] | null } {
  return { ...row, eligibleTierIds: row.eligibleTierIds ? (JSON.parse(row.eligibleTierIds) as string[]) : null };
}

/**
 * Events expansion (/plan-eng-review 2026-08-26, D1a, outside-voice fix) — the global cross-
 * community events feed needs viewer context (admin/tier) for every distinct communityId on a
 * fetched page, but calling resolveViewerContext() once per community would fire up to ~2N
 * queries in parallel for a diverse page (N = distinct communities, up to page size). This does
 * exactly 2 queries total regardless of N: one `communities WHERE id IN (...)` for the
 * creator-match path of isAuthorized(), one `memberships JOIN membershipTiers WHERE communityId
 * IN (...) AND walletAddress = ?` for the tier-match path — both of isAuthorized()'s two
 * independent admin paths, replicated here since this bypasses isAuthorized() itself for
 * batching. Used only by the global events endpoint; resolveViewerContext() is untouched.
 */
export async function resolveViewerContextsForCommunities(
  communityIds: string[],
  viewerAddress: string | undefined,
): Promise<Map<string, ViewerContext | null>> {
  const result = new Map<string, ViewerContext | null>();
  if (!viewerAddress || communityIds.length === 0) {
    for (const communityId of communityIds) result.set(communityId, null);
    return result;
  }

  const uniqueIds = [...new Set(communityIds)];
  const [creatorRows, tierRows] = await Promise.all([
    db
      .select({ id: communities.id, creatorAddress: communities.creatorAddress })
      .from(communities)
      .where(inArray(communities.id, uniqueIds)),
    db
      .select({
        communityId: memberships.communityId,
        tierId: memberships.tierId,
        canVote: membershipTiers.canVote,
        canManageMembership: membershipTiers.canManageMembership,
      })
      .from(memberships)
      .innerJoin(membershipTiers, eq(memberships.tierId, membershipTiers.id))
      .where(and(inArray(memberships.communityId, uniqueIds), eq(memberships.walletAddress, viewerAddress))),
  ]);

  const creatorByCommunity = new Map(creatorRows.map((row) => [row.id, row.creatorAddress]));
  const tierByCommunity = new Map(tierRows.map((row) => [row.communityId, row]));

  for (const communityId of uniqueIds) {
    const creatorAddress = creatorByCommunity.get(communityId);
    const tierRow = tierByCommunity.get(communityId);
    const isCreator = creatorAddress !== undefined && creatorAddress.toLowerCase() === viewerAddress.toLowerCase();
    result.set(communityId, {
      viewerAddress,
      isAdmin: isCreator || (tierRow?.canManageMembership ?? false),
      tier: tierRow ? { tierId: tierRow.tierId, canVote: tierRow.canVote } : null,
    });
  }
  return result;
}

/**
 * Batched membership check for a candidate list of addresses (governance restructure Phase 2,
 * 2026-08-20) — used to validate "person"-type (election) proposal options against real
 * community members without an N+1 loop. A single query, not one lookup per address.
 *
 * Case-insensitive: normalizes both the submitted addresses and the stored column to lowercase
 * before comparing. Every other address comparison in this file relies on the caller already
 * passing a consistently-cased address (established over time); this is a genuinely new
 * candidate-address surface (an election's member picker) with no such precedent to lean on, so
 * it normalizes explicitly rather than assuming.
 */
export async function listMembersByAddresses(communityId: string, walletAddresses: string[]): Promise<string[]> {
  if (walletAddresses.length === 0) return [];
  const normalized = [...new Set(walletAddresses.map((address) => address.toLowerCase()))];

  const rows = await db
    .select({ walletAddress: memberships.walletAddress })
    .from(memberships)
    .where(
      and(eq(memberships.communityId, communityId), inArray(sql`lower(${memberships.walletAddress})`, normalized)),
    );

  return rows.map((row) => row.walletAddress.toLowerCase());
}

/**
 * Full member listing for a community (governance restructure Phase 2, 2026-08-20) — feeds the
 * person-type (election) proposal creation UI's member picker. Gated on membership at the route
 * level (GET /:id/members, routes/membership.ts) — wallet addresses aren't a public directory,
 * but any member (not just admins) needs this to pick election candidates.
 */
export async function listMembers(communityId: string): Promise<{ walletAddress: string; tierLabel: string }[]> {
  return db
    .select({ walletAddress: memberships.walletAddress, tierLabel: membershipTiers.label })
    .from(memberships)
    .innerJoin(membershipTiers, eq(memberships.tierId, membershipTiers.id))
    .where(eq(memberships.communityId, communityId));
}

// Union-as-community merge (2026-08-28) — accepts an optional transaction client so
// communityService.createCommunityRow() can call this from inside db.transaction() and have the
// tier insert commit/rollback atomically with the communities-row insert. Defaults to the
// module-level db for every pre-existing call site, unchanged.
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function createTiersForCommunity(
  communityId: string,
  tiers: TierBody[],
  defaultTierLabel: string,
  dbClient: DbOrTx = db,
): Promise<{ defaultTierId: string; creatorTierId: string }> {
  const now = Math.floor(Date.now() / 1000);
  const rows = tiers.map((tier) => ({
    id: randomUUID(),
    communityId,
    label: tier.label,
    canCreateProposals: tier.canCreateProposals,
    canVote: tier.canVote,
    canManageMembership: tier.canManageMembership,
    canDelegate: tier.canDelegate,
    canBeDelegatedTo: tier.canBeDelegatedTo,
    canCreateEvents: tier.canCreateEvents,
    canPostDiscussions: tier.canPostDiscussions,
    requiresCredential: tier.requiresCredential,
    createdAt: now,
  }));
  const inserted = await dbClient.insert(membershipTiers).values(rows).returning();
  const defaultTier = inserted.find((row) => row.label === defaultTierLabel);
  if (!defaultTier) {
    throw new Error(`defaultTierLabel "${defaultTierLabel}" does not match any provided tier`);
  }

  // The creator gets full authority in their own community regardless of which tier new
  // members land in by default (specs/004 Assumptions: "the creating admin is automatically
  // assigned the Admin tier... regardless of [defaultTierLabel]") — assign them the tier with
  // every permission enabled, preferring one literally labeled "Admin" if several qualify, and
  // falling back to the default tier only if no full-permission tier exists at all.
  const fullPermissionTiers = inserted.filter(
    (row) =>
      row.canCreateProposals && row.canVote && row.canManageMembership && row.canCreateEvents && row.canPostDiscussions,
  );
  const creatorTier = fullPermissionTiers.find((row) => row.label === "Admin") ?? fullPermissionTiers[0] ?? defaultTier;

  return { defaultTierId: defaultTier.id, creatorTierId: creatorTier.id };
}

export async function listTiers(communityId: string): Promise<MembershipTier[]> {
  return db.select().from(membershipTiers).where(eq(membershipTiers.communityId, communityId));
}

export async function listTiersWithDefault(communityId: string): Promise<(MembershipTier & { isDefault: boolean })[]> {
  const [tiers, [community]] = await Promise.all([
    listTiers(communityId),
    db
      .select({ defaultTierId: communities.defaultTierId })
      .from(communities)
      .where(eq(communities.id, communityId))
      .limit(1),
  ]);
  return tiers.map((tier) => ({ ...tier, isDefault: tier.id === community?.defaultTierId }));
}

export async function assertTierChangesAllowed(communityId: string): Promise<void> {
  const [community] = await db
    .select({ tierChangesRequireVote: communities.tierChangesRequireVote })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  if (community?.tierChangesRequireVote) {
    throw new TierChangesRequireVoteError();
  }
}

export async function updateTier(
  communityId: string,
  tierId: string,
  patch: Partial<TierBody>,
): Promise<MembershipTier> {
  await assertTierChangesAllowed(communityId);
  const [updated] = await db
    .update(membershipTiers)
    .set(patch)
    .where(and(eq(membershipTiers.id, tierId), eq(membershipTiers.communityId, communityId)))
    .returning();
  if (!updated) throw new Error("Tier not found");
  return updated;
}

export async function deleteTier(communityId: string, tierId: string): Promise<void> {
  await assertTierChangesAllowed(communityId);

  const [community] = await db
    .select({ defaultTierId: communities.defaultTierId })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  if (community?.defaultTierId === tierId) {
    throw new TierInUseError();
  }

  const memberRows = await db
    .select({ walletAddress: memberships.walletAddress })
    .from(memberships)
    .where(eq(memberships.tierId, tierId))
    .limit(1);
  if (memberRows.length > 0) {
    throw new TierInUseError();
  }

  // Eligibility-adapters review (2026-08-19), D8 — a tier targeted by an eligibility rule
  // (eligibilityRules.targetTierId) can't be deleted either; the FK itself has no ON DELETE
  // behavior set specifically so this app-level guard is the primary protection, not a backstop.
  const targetingRules = await db
    .select({ id: eligibilityRules.id })
    .from(eligibilityRules)
    .where(eq(eligibilityRules.targetTierId, tierId))
    .limit(1);
  if (targetingRules.length > 0) {
    throw new TierInUseError();
  }

  await db
    .delete(membershipTiers)
    .where(and(eq(membershipTiers.id, tierId), eq(membershipTiers.communityId, communityId)));
}

export async function getMembershipStatus(
  communityId: string,
  walletAddress: string,
): Promise<{ status: "member" | "pending" | "none"; tierLabel?: string }> {
  const [membership] = await db
    .select({ label: membershipTiers.label })
    .from(memberships)
    .innerJoin(membershipTiers, eq(memberships.tierId, membershipTiers.id))
    .where(and(eq(memberships.walletAddress, walletAddress), eq(memberships.communityId, communityId)))
    .limit(1);
  if (membership) return { status: "member", tierLabel: membership.label };

  const [pendingRequest] = await db
    .select({ id: joinRequests.id })
    .from(joinRequests)
    .where(
      and(
        eq(joinRequests.walletAddress, walletAddress),
        eq(joinRequests.communityId, communityId),
        eq(joinRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (pendingRequest) return { status: "pending" };

  return { status: "none" };
}

export async function submitJoinRequest(
  communityId: string,
  walletAddress: string,
): Promise<{ status: "approved" | "pending"; tierLabel?: string }> {
  const [existingMembership] = await db
    .select({ walletAddress: memberships.walletAddress })
    .from(memberships)
    .where(and(eq(memberships.walletAddress, walletAddress), eq(memberships.communityId, communityId)))
    .limit(1);
  if (existingMembership) throw new DuplicateJoinError();

  const [pendingRequest] = await db
    .select({ id: joinRequests.id })
    .from(joinRequests)
    .where(
      and(
        eq(joinRequests.walletAddress, walletAddress),
        eq(joinRequests.communityId, communityId),
        eq(joinRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (pendingRequest) throw new DuplicateJoinError();

  const [community] = await db
    .select({
      membershipPolicy: communities.membershipPolicy,
      defaultTierId: communities.defaultTierId,
      allowJoin: communities.allowJoin,
    })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  if (!community?.defaultTierId) {
    throw new Error("Community has no default tier configured");
  }

  // Checked before eligibility evaluation, not after — allowJoin=false means joining isn't
  // possible at all, so there's no reason to spend a (potentially expensive) eligibility ruleset
  // evaluation on a request that was always going to be blocked (formalize-communities epic,
  // Child C1, /plan-eng-review 2026-08-24).
  if (!community.allowJoin) throw new JoinNotAllowedError();

  // Eligibility-adapters review (2026-08-19), D2/D2b — eligibility gates whether a wallet may
  // join at all AND resolves which tier it lands in; membershipPolicy (open/approval) is a
  // separate, orthogonal layer applied AFTER eligibility passes (does joining need a human's
  // approval, not whether the wallet is allowed to join in the first place). Evaluated once,
  // here, at submission time — not re-evaluated later for the approval path (D7).
  // eligibility-followups review (2026-08-19), D1 — evaluateEligibilityAcrossUnion wraps
  // evaluateRuleset with a live union-eligibility fallback; behaves identically to the plain
  // evaluateRuleset call for any community with no active union membership.
  const evaluation = await evaluateEligibilityAcrossUnion(communityId, walletAddress);
  if (!evaluation.eligible) throw new NotEligibleError(evaluation.reason);
  const resolvedTierId = evaluation.tierId ?? community.defaultTierId;

  const now = Math.floor(Date.now() / 1000);

  if (community.membershipPolicy === "open") {
    await db.insert(memberships).values({ walletAddress, communityId, tierId: resolvedTierId, joinedAt: now });
    const [tier] = await db
      .select({ label: membershipTiers.label })
      .from(membershipTiers)
      .where(eq(membershipTiers.id, resolvedTierId))
      .limit(1);
    return { status: "approved", tierLabel: tier?.label };
  }

  await db.insert(joinRequests).values({
    id: randomUUID(),
    communityId,
    walletAddress,
    status: "pending",
    tierId: resolvedTierId,
    createdAt: now,
    resolvedAt: null,
  });
  return { status: "pending" };
}

/**
 * formalize-communities epic, Child F (/plan-eng-review 2026-08-25) — deletes the caller's own
 * memberships row. Does NOT touch joinRequests history (AC5) — approved/rejected records stay
 * for audit regardless of a later leave.
 *
 * Guard order: creator check (D1) and governance check (D3) both run before the delete attempt,
 * so a blocked caller never sees a query that could have succeeded. The delete itself is a single
 * atomic DELETE...RETURNING (D2) — not a separate SELECT-then-DELETE — so a second concurrent
 * Leave call (double-click, stale second tab) can't race the first: at most one caller sees a row
 * back, the other sees an empty result and gets NotAMemberError, never a silent no-op success.
 */
export async function leave(communityId: string, walletAddress: string): Promise<void> {
  const [community] = await db
    .select({ creatorAddress: communities.creatorAddress })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  if (community?.creatorAddress.toLowerCase() === walletAddress.toLowerCase()) {
    throw new CreatorCannotLeaveError();
  }

  const attachedAdapters = await listAvailableDecisionAdapters(communityId);
  if (attachedAdapters.length > 0) throw new CommunityHasGovernanceError();

  const deleted = await db
    .delete(memberships)
    .where(and(eq(memberships.walletAddress, walletAddress), eq(memberships.communityId, communityId)))
    .returning();
  if (deleted.length === 0) throw new NotAMemberError();
}

/** Communities this wallet holds an approved membership in — used by the profile page's
 * "awaiting actions" section to know which communities' governance actions to check. */
export async function listMembershipsForWallet(walletAddress: string): Promise<{ communityId: string }[]> {
  return db
    .select({ communityId: memberships.communityId })
    .from(memberships)
    .where(eq(memberships.walletAddress, walletAddress));
}

export async function listPendingRequests(
  communityId: string,
): Promise<{ id: string; walletAddress: string; createdAt: number }[]> {
  return db
    .select({ id: joinRequests.id, walletAddress: joinRequests.walletAddress, createdAt: joinRequests.createdAt })
    .from(joinRequests)
    .where(and(eq(joinRequests.communityId, communityId), eq(joinRequests.status, "pending")));
}

async function getPendingRequest(requestId: string) {
  const [request] = await db
    .select()
    .from(joinRequests)
    .where(and(eq(joinRequests.id, requestId), eq(joinRequests.status, "pending")))
    .limit(1);
  if (!request) throw new RequestNotFoundError();
  return request;
}

export async function approveRequest(requestId: string): Promise<void> {
  const request = await getPendingRequest(requestId);

  // Eligibility-adapters review (2026-08-19), D7 — the tier was already resolved at submission
  // time (submitJoinRequest) and stored on the request; approval never re-runs eligibility. The
  // defaultTierId fallback here is defensive only (a request submitted before this column
  // existed) and should not be hit for any request created after this change lands.
  let tierId = request.tierId;
  if (!tierId) {
    const [community] = await db
      .select({ defaultTierId: communities.defaultTierId })
      .from(communities)
      .where(eq(communities.id, request.communityId))
      .limit(1);
    if (!community?.defaultTierId) {
      throw new Error("Community has no default tier configured");
    }
    tierId = community.defaultTierId;
  }

  const now = Math.floor(Date.now() / 1000);
  await db.insert(memberships).values({
    walletAddress: request.walletAddress,
    communityId: request.communityId,
    tierId,
    joinedAt: now,
  });
  await db.update(joinRequests).set({ status: "approved", resolvedAt: now }).where(eq(joinRequests.id, requestId));
}

export async function rejectRequest(requestId: string): Promise<void> {
  await getPendingRequest(requestId);
  const now = Math.floor(Date.now() / 1000);
  await db.update(joinRequests).set({ status: "rejected", resolvedAt: now }).where(eq(joinRequests.id, requestId));
}
