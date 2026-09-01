import type { Hex } from "viem";
import type { SignUpPolicyArgs } from "@/src/config";
import type { CommunityCategory } from "@/src/services/communityApi";
import type { Protocol } from "@/src/services/credentialApi";

export type DeployPhase = "deploy_sign_up_policy" | "deploy_maci" | "set_target" | "save_community";

export type MembershipPolicy = "open" | "approval";

export interface TierDraft {
  label: string;
  canCreateProposals: boolean;
  canVote: boolean;
  canManageMembership: boolean;
  canCreateEvents: boolean;
  // Credential wedge (2026-08-29 /plan-eng-review, E0) — null (no gate) unless an admin
  // explicitly opts a tier in. Unlike canCreateEvents, this has no "default true" posture: it
  // ships OFF everywhere by default, since activating it depends on an external dependency (a
  // real Zupass credential pipeline, see TODOS.md) outside this app's control.
  requiresCredential: Protocol | null;
}

export interface MACIDeploymentConfig {
  displayName: string;
  description: string;
  // Local chapters, event teams, and contributor circles nest under a parent community
  // (Lightpaper's "communities and sub-communities" building block).
  parentCommunityId?: string;
  // Creator-selected community type tag, independent of voting mechanism — specs/010 US5.
  category?: CommunityCategory;
  signUpPolicy: SignUpPolicyArgs;
  allowedPolicies: number[];
  supportedModes: number[];
  stateTreeDepth: 10;
  membershipPolicy: MembershipPolicy;
  tierChangesRequireVote: boolean;
  tiers: TierDraft[];
  defaultTierLabel: string;
}

export interface PendingDeploymentCheckpoint {
  config: MACIDeploymentConfig;
  lastPhase: DeployPhase;
  // The community's identity id (server-generated UUID), created before any on-chain deployment
  // starts (Architecture 1A/1B). Persisted immediately so a resumed wizard run reuses the same
  // identity instead of calling createIdentity() again — wizard-path identity creation has no
  // natural retry key the way a client-supplied contract address would.
  identityCommunityId?: string;
  deployedSignUpPolicyAddress?: Hex;
  deployedMaciAddress?: Hex;
  deployedMaciBlockNumber?: number;
  chainId: number;
  startedAt: number;
}

const PENDING_PREFIX = "pending_deployment_";

// Keyed by wallet AND community (not wallet alone) so a wallet can have two off-chain
// communities each mid-deploy without one's checkpoint clobbering the other's — either by a
// stale resume reading the wrong one, or by two tabs writing phase updates for different
// communities to the same slot (2026-08-19 community-creation-rework review, D5).
function checkpointKey(wallet: Hex, communityId: string): string {
  return `${PENDING_PREFIX}${wallet.toLowerCase()}_${communityId}`;
}

export function savePendingCheckpoint(wallet: Hex, communityId: string, checkpoint: PendingDeploymentCheckpoint): void {
  localStorage.setItem(checkpointKey(wallet, communityId), JSON.stringify(checkpoint));
}

export function getPendingCheckpoint(wallet: Hex, communityId: string): PendingDeploymentCheckpoint | null {
  const raw = localStorage.getItem(checkpointKey(wallet, communityId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingDeploymentCheckpoint;
  } catch {
    return null;
  }
}

export function clearPendingCheckpoint(wallet: Hex, communityId: string): void {
  localStorage.removeItem(checkpointKey(wallet, communityId));
}

/** Finds any pending checkpoint for this wallet, regardless of which community it belongs to —
 * used only by the wizard's recovery banner, which runs before any specific community is in
 * view (a fresh community_info screen has no communityId to look up yet). Every other call site
 * already knows which community it cares about and should use getPendingCheckpoint instead. */
export function findAnyPendingCheckpoint(
  wallet: Hex,
): { communityId: string; checkpoint: PendingDeploymentCheckpoint } | null {
  const prefix = `${PENDING_PREFIX}${wallet.toLowerCase()}_`;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      return { communityId: key.slice(prefix.length), checkpoint: JSON.parse(raw) as PendingDeploymentCheckpoint };
    } catch {
      continue;
    }
  }
  return null;
}
