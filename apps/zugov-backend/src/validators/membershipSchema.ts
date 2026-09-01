import { z } from "zod";

export const tierBodySchema = z.object({
  label: z.string().min(1).max(40),
  canCreateProposals: z.boolean(),
  canVote: z.boolean(),
  canManageMembership: z.boolean(),
  canDelegate: z.boolean().optional().default(false),
  canBeDelegatedTo: z.boolean().optional().default(false),
  // Events (2026-08-19 eng review): defaults true so a wizard-created tier matches the schema's
  // own default without the wizard having to know about it, but stays overridable per-tier.
  canCreateEvents: z.boolean().optional().default(true),
  // formalize-communities epic, Child J (/plan-eng-review 2026-08-26, D2) — same reasoning as
  // canCreateEvents above.
  canPostDiscussions: z.boolean().optional().default(true),
  // Credential wedge (2026-08-29 /plan-eng-review, E0) — defaults null (no gate) on every tier,
  // unlike canCreateEvents/canPostDiscussions' default-true posture: this ships OFF everywhere
  // until an admin explicitly opts a tier in, since activating it depends on an external
  // dependency (a real Zupass credential pipeline, see TODOS.md) outside this schema's control.
  requiresCredential: z.enum(["zupass", "zkid"]).nullable().optional().default(null),
});

export type TierBody = z.infer<typeof tierBodySchema>;

export const communityMembershipFieldsSchema = z.object({
  membershipPolicy: z.enum(["open", "approval"]),
  tierChangesRequireVote: z.boolean(),
  tiers: z.array(tierBodySchema).nonempty(),
  defaultTierLabel: z.string().min(1),
});

export type CommunityMembershipFields = z.infer<typeof communityMembershipFieldsSchema>;
