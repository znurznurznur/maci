import { randomUUID } from "node:crypto";
import { eq, and, asc, inArray } from "drizzle-orm";
import { createPublicClient, http, type Address } from "viem";
import { db } from "../db/client.js";
import {
  eligibilityRulesets,
  eligibilityRules,
  membershipTiers,
  memberships,
  unionMemberships,
  type EligibilityRule,
} from "../db/schema.js";
import { getRpcUrl } from "./chainRpc.js";

// System 1 of 3 identity/eligibility vocabularies (see ENGINEERING.md's Decisions Log,
// 2026-09-01) — governs community/tier JOIN eligibility. Distinct from SignUpPolicyType (poll
// voter registration, apps/zugov-frontend/src/config.ts) and credential verification
// (IdentityProvider.ts / credentialStore.ts). Independently redeclared (not imported) in
// apps/zugov-frontend/src/services/eligibilityApi.ts — keep both in sync.
export type EligibilityMechanism = "open" | "tier" | "erc20_token";

export interface EligibilityContext {
  communityId: string;
  wallet: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

export interface EligibilityAdapter {
  mechanism: EligibilityMechanism;
  evaluate(config: unknown, ctx: EligibilityContext): Promise<EligibilityResult>;
}

// ─── Adapters ──────────────────────────────────────────────────────────────
//
// Exactly 3 this pass (2026-08-19 eligibility-adapters review, Step 0 scope reduction), chosen
// to prove the pattern across off-chain (Tier), on-chain (ERC20Token), and hybrid-via-composition
// (a ruleset combining both), not driven by which on-chain policies happen to be deployed on
// Sepolia today. The other 8 mechanism kinds are individual follow-up TODOs — each is additive
// once this registry exists, none of them require touching the evaluator itself.

const openAdapter: EligibilityAdapter = {
  mechanism: "open",
  async evaluate() {
    return { eligible: true };
  },
};

interface TierConfig {
  tierId: string;
}

// Off-chain: does the wallet already hold a specific existing tier — useful as one AND-condition
// toward a higher tier (e.g. "already Resident" as part of what unlocks "OG").
const tierAdapter: EligibilityAdapter = {
  mechanism: "tier",
  async evaluate(config, ctx) {
    const { tierId } = config as TierConfig;
    const [row] = await db
      .select({ tierId: memberships.tierId })
      .from(memberships)
      .where(and(eq(memberships.walletAddress, ctx.wallet), eq(memberships.communityId, ctx.communityId)))
      .limit(1);
    if (!row) return { eligible: false, reason: "Not yet a member of this community" };
    if (row.tierId !== tierId) return { eligible: false, reason: "Does not hold the required tier" };
    return { eligible: true };
  },
};

interface Erc20TokenConfig {
  chainId: number;
  tokenAddress: string;
  // bigint-as-string — JSON can't carry a real bigint, matches how other on-chain amounts are
  // handled elsewhere in this app (e.g. governance's initialVoiceCreditAmount).
  threshold: string;
}

const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

// On-chain: real balanceOf() read, reusing the exact viem pattern already established in
// contractOwnership.ts (getRpcUrl + createPublicClient). The RPC-failure-to-reason-string
// translation below is new logic this adapter owns — contractOwnership.ts's own error classes
// are thrown, not returned as a soft-fail shape, so they can't be reused as-is here (2026-08-19
// eligibility-adapters review, outside-voice correction).
//
// Known, documented-not-solved risk: a point-in-time balanceOf() read can be gamed with a
// flash loan/flash mint immediately before the check (see TODOS.md) — more consequential here
// than a one-time vote-weight snapshot elsewhere in the app, since this determines membership/
// tier grant. Accepted for this pass; needs real mitigation before high-stakes production use.
const erc20TokenAdapter: EligibilityAdapter = {
  mechanism: "erc20_token",
  async evaluate(config, ctx) {
    const { chainId, tokenAddress, threshold } = config as Erc20TokenConfig;
    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) return { eligible: false, reason: `No RPC configured for chain ${chainId}` };

    const client = createPublicClient({ transport: http(rpcUrl) });

    let balance: bigint;
    try {
      balance = await client.readContract({
        address: tokenAddress as Address,
        abi: ERC20_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [ctx.wallet as Address],
      });
    } catch {
      return { eligible: false, reason: "Could not read on-chain token balance right now" };
    }

    const thresholdBigInt = BigInt(threshold);
    if (balance < thresholdBigInt) {
      return { eligible: false, reason: `Token balance ${balance} is below the required ${thresholdBigInt}` };
    }
    return { eligible: true };
  },
};

const ADAPTERS: Record<EligibilityMechanism, EligibilityAdapter> = {
  open: openAdapter,
  tier: tierAdapter,
  erc20_token: erc20TokenAdapter,
};

// ─── Ruleset evaluation ────────────────────────────────────────────────────

export interface RulesetEvaluation {
  eligible: boolean;
  // null: either ineligible, or eligible via a group with no tier-targeting — caller falls back
  // to the community's own defaultTierId (2026-08-19 review, D4's "absence = Open" default
  // extends naturally to "no explicit target = defer to defaultTierId").
  tierId: string | null;
  reason?: string;
}

/**
 * DNF evaluation (2026-08-19 review, D1): rules sharing a groupIndex are AND-ed; distinct
 * groupIndex values are OR-ed. A wallet is eligible if ANY group's rules all pass. When multiple
 * groups pass, the group targeting the highest-rank tier wins (D2c) — groups with no
 * targetTierId don't participate in that tournament at all.
 *
 * No ruleset row for this community -> {eligible: true, tierId: null} (D4: absence = Open,
 * identical to every community's real behavior before this system existed).
 */
export async function evaluateRuleset(communityId: string, wallet: string): Promise<RulesetEvaluation> {
  const [ruleset] = await db
    .select({ id: eligibilityRulesets.id })
    .from(eligibilityRulesets)
    .where(eq(eligibilityRulesets.communityId, communityId))
    .limit(1);
  if (!ruleset) return { eligible: true, tierId: null };

  const rules = await db
    .select()
    .from(eligibilityRules)
    .where(eq(eligibilityRules.rulesetId, ruleset.id))
    .orderBy(asc(eligibilityRules.groupIndex));
  if (rules.length === 0) return { eligible: true, tierId: null };

  const groups = new Map<number, EligibilityRule[]>();
  for (const rule of rules) {
    const group = groups.get(rule.groupIndex) ?? [];
    group.push(rule);
    groups.set(rule.groupIndex, group);
  }

  const ctx: EligibilityContext = { communityId, wallet };
  const passingGroupTargetTierIds: string[] = [];
  const failureReasons: string[] = [];

  for (const [, groupRules] of groups) {
    let groupPasses = true;
    let firstFailureReason: string | undefined;
    for (const rule of groupRules) {
      const adapter = ADAPTERS[rule.mechanism];
      const config: unknown = JSON.parse(rule.config);
      const result = await adapter.evaluate(config, ctx);
      if (!result.eligible) {
        groupPasses = false;
        firstFailureReason ??= result.reason;
        break;
      }
    }
    if (groupPasses) {
      if (groupRules[0]?.targetTierId) passingGroupTargetTierIds.push(groupRules[0].targetTierId);
      else passingGroupTargetTierIds.push(""); // eligible, no tier target — see below
    } else if (firstFailureReason) {
      failureReasons.push(firstFailureReason);
    }
  }

  const anyGroupPassed = passingGroupTargetTierIds.length > 0;
  if (!anyGroupPassed) {
    return {
      eligible: false,
      tierId: null,
      reason: failureReasons.length > 0 ? failureReasons.join("; or ") : "Does not meet any eligibility requirement",
    };
  }

  const targetedTierIds = passingGroupTargetTierIds.filter((id) => id !== "");
  if (targetedTierIds.length === 0) return { eligible: true, tierId: null };

  const tierRows = await db
    .select({ id: membershipTiers.id, rank: membershipTiers.rank })
    .from(membershipTiers)
    .where(eq(membershipTiers.communityId, communityId));
  const rankById = new Map(tierRows.map((t) => [t.id, t.rank]));

  let winningTierId = targetedTierIds[0]!;
  let winningRank = rankById.get(winningTierId) ?? 0;
  for (const tierId of targetedTierIds.slice(1)) {
    const rank = rankById.get(tierId) ?? 0;
    if (rank > winningRank) {
      winningTierId = tierId;
      winningRank = rank;
    }
  }

  return { eligible: true, tierId: winningTierId };
}

// ─── Union eligibility ─────────────────────────────────────────────────────

/**
 * Extends evaluateRuleset with a live, union-aware fallback (2026-08-19 eligibility-follow-ups
 * review, D1): if a wallet fails a community's own ruleset, and that community is an active
 * member of one or more unions, it also gets checked against each active sibling community's own
 * ruleset (pooled across every union the community belongs to, self excluded, short-circuited on
 * first pass). Any sibling pass makes the wallet eligible here too — tierId comes back null (no
 * explicit target), so the caller's existing "?? community.defaultTierId" fallback applies; a
 * sibling's targetTierId can never map onto a different community's own tiers.
 *
 * Nothing is stored or "refreshed" on union accept/leave — this recomputes live on every call, so
 * union membership changes (join, leave, a sibling editing its own ruleset) take effect
 * immediately with no separate sync step and no staleness window.
 *
 * A sibling with NO configured ruleset (Open — evaluateRuleset's own "absence = Open" default) is
 * excluded from the pool entirely, not treated as an automatic pass. Without this, any active
 * union member could unilaterally invite() a bare community and, the moment its own admin
 * accepts, silently hand every wallet on earth eligibility into every other union member — caught
 * during this review's outside-voice pass.
 */
export async function evaluateEligibilityAcrossUnion(communityId: string, wallet: string): Promise<RulesetEvaluation> {
  const ownResult = await evaluateRuleset(communityId, wallet);
  if (ownResult.eligible) return ownResult;

  const activeUnionRows = await db
    .select({ unionId: unionMemberships.unionId })
    .from(unionMemberships)
    .where(and(eq(unionMemberships.communityId, communityId), eq(unionMemberships.status, "active")));
  if (activeUnionRows.length === 0) return ownResult;

  const unionIds = activeUnionRows.map((row) => row.unionId);
  const siblingRows = await db
    .select({ communityId: unionMemberships.communityId })
    .from(unionMemberships)
    .where(and(inArray(unionMemberships.unionId, unionIds), eq(unionMemberships.status, "active")));
  const siblingIds = [...new Set(siblingRows.map((row) => row.communityId))].filter((id) => id !== communityId);

  for (const siblingId of siblingIds) {
    const siblingRules = await getRuleset(siblingId);
    if (siblingRules.length === 0) continue; // Open sibling never extends trust — trust-gap fix
    const siblingResult = await evaluateRuleset(siblingId, wallet);
    if (siblingResult.eligible) {
      return { eligible: true, tierId: null };
    }
  }

  return ownResult;
}

// ─── Ruleset management ────────────────────────────────────────────────────

export interface RuleInput {
  groupIndex: number;
  mechanism: EligibilityMechanism;
  config: unknown;
  targetTierId?: string;
}

/** Replaces the community's entire ruleset in one transaction — a ruleset is edited as a whole,
 * not rule-by-rule, matching how a creator actually thinks about "here's my new set of rules". */
export async function replaceRuleset(communityId: string, rules: RuleInput[]): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.transaction(async (tx) => {
    let [ruleset] = await tx
      .select({ id: eligibilityRulesets.id })
      .from(eligibilityRulesets)
      .where(eq(eligibilityRulesets.communityId, communityId))
      .limit(1);

    if (!ruleset) {
      [ruleset] = await tx
        .insert(eligibilityRulesets)
        .values({ id: randomUUID(), communityId, createdAt: now, updatedAt: now })
        .returning({ id: eligibilityRulesets.id });
    } else {
      await tx.update(eligibilityRulesets).set({ updatedAt: now }).where(eq(eligibilityRulesets.id, ruleset.id));
    }

    await tx.delete(eligibilityRules).where(eq(eligibilityRules.rulesetId, ruleset!.id));
    if (rules.length > 0) {
      await tx.insert(eligibilityRules).values(
        rules.map((rule) => ({
          id: randomUUID(),
          rulesetId: ruleset!.id,
          groupIndex: rule.groupIndex,
          mechanism: rule.mechanism,
          config: JSON.stringify(rule.config),
          targetTierId: rule.targetTierId ?? null,
          createdAt: now,
        })),
      );
    }
  });
}

export async function getRuleset(communityId: string): Promise<EligibilityRule[]> {
  const [ruleset] = await db
    .select({ id: eligibilityRulesets.id })
    .from(eligibilityRulesets)
    .where(eq(eligibilityRulesets.communityId, communityId))
    .limit(1);
  if (!ruleset) return [];
  return db
    .select()
    .from(eligibilityRules)
    .where(eq(eligibilityRules.rulesetId, ruleset.id))
    .orderBy(asc(eligibilityRules.groupIndex));
}
