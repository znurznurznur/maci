import type { TierDraft } from "@/src/services/checkpointStore";

export type EditableTier = TierDraft & { id?: string };

interface Props {
  tiers: EditableTier[];
  onChange: (tiers: EditableTier[]) => void;
  // Parent-owned — e.g. the edit page's "tier changes require a vote" toggle locks this. A
  // purely tier-editing component has no opinion on governance policy, so it takes a plain
  // boolean rather than owning that concept itself (2026-08-19 community-creation-rework
  // review, D8).
  locked?: boolean;
}

/** Controlled, no network calls — every call site (creation, post-creation edit) owns its own
 * save logic. Shared so tier-editing behavior (add/remove/toggle, last-tier guard) can't drift
 * between the two places it's used. */
export function TierEditor({ tiers, onChange, locked = false }: Props) {
  function updateTierField(index: number, patch: Partial<TierDraft>) {
    onChange(tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function removeTierAt(index: number) {
    if (tiers.length <= 1) return;
    onChange(tiers.filter((_, i) => i !== index));
  }

  function addTier() {
    onChange([
      ...tiers,
      {
        label: `Tier ${tiers.length + 1}`,
        canCreateProposals: false,
        canVote: false,
        canManageMembership: false,
        // Matches the backend's own tierBodySchema default (canCreateEvents: true) so a
        // blank tier added here behaves the same as one created without this field set at all.
        canCreateEvents: true,
        // Matches the backend's own default (null, no gate) — this one ships OFF, unlike
        // canCreateEvents above.
        requiresCredential: null,
      },
    ]);
  }

  return (
    <div className="space-y-3">
      {locked && (
        <p className="text-sm text-amber-400 bg-amber-900/20 border border-amber-700/40 rounded-lg p-3">
          This community's tier changes require a community vote, which is not yet available.
        </p>
      )}
      <div className="space-y-3">
        {tiers.map((tier, i) => (
          <div key={tier.id ?? `new-${i}`} className="p-4 border-2 border-gray-700 rounded-lg space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={tier.label}
                disabled={locked}
                onChange={(e) => updateTierField(i, { label: e.target.value })}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 text-foreground rounded-lg text-sm disabled:bg-gray-800/40 disabled:text-gray-500"
              />
              {!locked && (
                <button
                  type="button"
                  onClick={() => removeTierAt(i)}
                  disabled={tiers.length <= 1}
                  className="text-xs text-red-400 hover:text-red-300 disabled:opacity-30 px-2"
                >
                  Remove
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <label className="flex items-center gap-1.5 text-sm text-gray-300">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={tier.canCreateProposals}
                  onChange={(e) => updateTierField(i, { canCreateProposals: e.target.checked })}
                />
                Can create polls
              </label>
              <label className="flex items-center gap-1.5 text-sm text-gray-300">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={tier.canVote}
                  onChange={(e) => updateTierField(i, { canVote: e.target.checked })}
                />
                Can vote
              </label>
              <label className="flex items-center gap-1.5 text-sm text-gray-300">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={tier.canManageMembership}
                  onChange={(e) => updateTierField(i, { canManageMembership: e.target.checked })}
                />
                Can manage membership
              </label>
              <label className="flex items-center gap-1.5 text-sm text-gray-300">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={tier.canCreateEvents}
                  onChange={(e) => updateTierField(i, { canCreateEvents: e.target.checked })}
                />
                Can create events
              </label>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm text-gray-300">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={tier.requiresCredential !== null}
                  onChange={(e) => updateTierField(i, { requiresCredential: e.target.checked ? "zupass" : null })}
                />
                Requires a verified credential
              </label>
              {tier.requiresCredential !== null && (
                <select
                  disabled={locked}
                  value={tier.requiresCredential}
                  onChange={(e) => updateTierField(i, { requiresCredential: e.target.value as "zupass" | "zkid" })}
                  className="px-2 py-1 bg-gray-800 border border-gray-600 text-foreground rounded text-sm disabled:bg-gray-800/40 disabled:text-gray-500"
                >
                  <option value="zupass">Zupass</option>
                  <option value="zkid">zkID</option>
                </select>
              )}
            </div>
          </div>
        ))}
      </div>
      {!locked && (
        <button type="button" onClick={addTier} className="text-sm text-accent-hover hover:text-accent font-medium">
          + Add tier
        </button>
      )}
    </div>
  );
}
