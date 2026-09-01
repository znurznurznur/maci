import {
  createIdentity,
  attachGovernance,
  update,
  GovernanceAlreadyConfiguredError,
} from "../services/communityService.js";
import type { IdentityBody, GovernanceBody } from "../validators/communitySchema.js";
import type { TierBody } from "../validators/membershipSchema.js";

const DEFAULT_TIERS: [TierBody, ...TierBody[]] = [
  {
    label: "Guest",
    canCreateProposals: false,
    canVote: false,
    canManageMembership: false,
    canDelegate: false,
    canBeDelegatedTo: false,
    canCreateEvents: true,
    canPostDiscussions: true,
    requiresCredential: null,
  },
  {
    label: "Visitor",
    canCreateProposals: false,
    canVote: false,
    canManageMembership: false,
    canDelegate: false,
    canBeDelegatedTo: false,
    canCreateEvents: true,
    canPostDiscussions: true,
    requiresCredential: null,
  },
  {
    label: "Regular",
    canCreateProposals: false,
    canVote: true,
    canManageMembership: false,
    canDelegate: false,
    canBeDelegatedTo: false,
    canCreateEvents: true,
    canPostDiscussions: true,
    requiresCredential: null,
  },
  {
    label: "OG",
    canCreateProposals: true,
    canVote: true,
    canManageMembership: false,
    canDelegate: false,
    canBeDelegatedTo: false,
    canCreateEvents: true,
    canPostDiscussions: true,
    requiresCredential: null,
  },
  {
    label: "Manager",
    canCreateProposals: true,
    canVote: true,
    canManageMembership: true,
    canDelegate: false,
    canBeDelegatedTo: false,
    canCreateEvents: true,
    canPostDiscussions: true,
    requiresCredential: null,
  },
  {
    label: "Admin",
    canCreateProposals: true,
    canVote: true,
    canManageMembership: true,
    canDelegate: false,
    canBeDelegatedTo: false,
    canCreateEvents: true,
    canPostDiscussions: true,
    requiresCredential: null,
  },
];

const SEED_COMMUNITIES: { id: string; creatorAddress: string; identity: IdentityBody; governance: GovernanceBody }[] = [
  {
    id: "0xFCeA194e9B7A9A785C1a7d2bCd08f9D7b123456a",
    creatorAddress: "0x0000000000000000000000000000000000000001",
    identity: {
      displayName: "ZuKas Residency",
      description: "ZuKas Residency community governance via MACI",
      logo: "🏛️",
      membershipPolicy: "open",
      tierChangesRequireVote: false,
      tiers: DEFAULT_TIERS,
      defaultTierLabel: "Regular",
    },
    governance: {
      contractAddress: "0xFCeA194e9B7A9A785C1a7d2bCd08f9D7b123456a",
      chainId: 534351,
      allowedPolicies: [0, 1],
      supportedModes: [0, 1],
      signUpPolicyType: "FreeForAll",
      signUpPolicyAddress: "0x0000000000000000000000000000000000000011",
      maciDeploymentBlock: 18199019,
      stateTreeDepth: 6,
    },
  },
  {
    id: "0x365d6B5A48dc7D4bC83e78f31c01e4E34567890B",
    creatorAddress: "0x0000000000000000000000000000000000000002",
    identity: {
      displayName: "ETH-NS",
      description: "ETH Name Service governance community",
      logo: "🌐",
      membershipPolicy: "open",
      tierChangesRequireVote: false,
      tiers: DEFAULT_TIERS,
      defaultTierLabel: "Regular",
    },
    governance: {
      contractAddress: "0x365d6B5A48dc7D4bC83e78f31c01e4E34567890B",
      chainId: 534351,
      allowedPolicies: [0],
      supportedModes: [0],
      signUpPolicyType: "FreeForAll",
      signUpPolicyAddress: "0x0000000000000000000000000000000000000012",
      maciDeploymentBlock: 16833449,
      stateTreeDepth: 10,
    },
  },
];

// specs/007 T022: seeded separately from SEED_COMMUNITIES via update() rather than as a create()
// field, since directDeploymentEnabled is deliberately PATCH-only (data-model.md) — there's no
// creation-time path for it.
const DIRECT_DEPLOYMENT_COMMUNITY_ID = "0x365d6B5A48dc7D4bC83e78f31c01e4E34567890B";

async function seed() {
  console.log("Seeding communities...");
  for (const seedCommunity of SEED_COMMUNITIES) {
    const { created } = await createIdentity({
      id: seedCommunity.id,
      creatorAddress: seedCommunity.creatorAddress,
      ...seedCommunity.identity,
    });
    if (created) {
      await attachGovernance(seedCommunity.id, seedCommunity.governance).catch((err: unknown) => {
        if (err instanceof GovernanceAlreadyConfiguredError) return;
        throw err;
      });
    }
    console.log(`  ${created ? "✓ Created" : "  Skipped (exists)"}: ${seedCommunity.identity.displayName}`);
  }
  await update(DIRECT_DEPLOYMENT_COMMUNITY_ID, { directDeploymentEnabled: true });
  console.log("  ✓ Enabled direct deployment on ETH-NS (for local direct-deploy testing)");
  console.log("Done.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
