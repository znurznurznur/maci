import { parseErrorOr } from "@/src/services/httpClient";

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

// Mirrors apps/zugov-backend/src/services/eligibilityService.ts's EligibilityMechanism —
// independently redeclared here, not imported (frontend/backend don't share types across the
// wire). System 1 of 3 identity/eligibility vocabularies — see ENGINEERING.md's Decisions Log,
// 2026-09-01.
export type EligibilityMechanism = "open" | "tier" | "erc20_token";

export interface OpenConfig {}
export interface TierConfig {
  tierId: string;
}
export interface Erc20TokenConfig {
  chainId: number;
  tokenAddress: string;
  // bigint-as-string — matches the backend's storage/validation (avoids JSON's lack of a real
  // bigint type), see eligibilitySchema.ts.
  threshold: string;
}

export type RuleConfig = OpenConfig | TierConfig | Erc20TokenConfig;

/** A rule as edited in the UI, before it's been persisted (or freshly parsed off the wire). */
export interface RuleDraft {
  groupIndex: number;
  mechanism: EligibilityMechanism;
  config: RuleConfig;
  targetTierId?: string;
}

/** A rule as returned by GET — the backend stores `config` as a JSON string; this client parses
 * it into a real object so callers never juggle both shapes. */
export interface EligibilityRule extends RuleDraft {
  id: string;
}

export async function getRuleset(communityId: string): Promise<EligibilityRule[]> {
  const res = await fetch(`${BASE_URL}/api/communities/${communityId}/eligibility-ruleset`);
  const data = await parseErrorOr<{
    rules: {
      id: string;
      groupIndex: number;
      mechanism: EligibilityMechanism;
      config: string;
      targetTierId: string | null;
    }[];
  }>(res, `Failed to fetch eligibility ruleset: ${res.status}`);
  return data.rules.map((rule) => ({
    id: rule.id,
    groupIndex: rule.groupIndex,
    mechanism: rule.mechanism,
    config: JSON.parse(rule.config) as RuleConfig,
    targetTierId: rule.targetTierId ?? undefined,
  }));
}

/** Replaces the community's entire ruleset — matches the backend's replace-as-a-whole semantics
 * (a creator edits "here's my new set of rules", not one rule at a time). Passing an empty array
 * reverts the community to Open (no ruleset row = always eligible). */
export async function replaceRuleset(communityId: string, rules: RuleDraft[]): Promise<EligibilityRule[]> {
  const res = await fetch(`${BASE_URL}/api/communities/${communityId}/eligibility-ruleset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ rules }),
  });
  const data = await parseErrorOr<{
    rules: {
      id: string;
      groupIndex: number;
      mechanism: EligibilityMechanism;
      config: string;
      targetTierId: string | null;
    }[];
  }>(res, `Failed to save eligibility ruleset: ${res.status}`);
  return data.rules.map((rule) => ({
    id: rule.id,
    groupIndex: rule.groupIndex,
    mechanism: rule.mechanism,
    config: JSON.parse(rule.config) as RuleConfig,
    targetTierId: rule.targetTierId ?? undefined,
  }));
}
