import { useState } from "react";
import { Link } from "react-router-dom";
import { useChainId } from "wagmi";
import { X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import * as membershipApi from "@/src/services/membershipApi";
import * as proposalApi from "@/src/services/proposalApi";
import * as credentialApi from "@/src/services/credentialApi";
import type {
  ProposalDecisionTargetType,
  ProposalExecutionLocation,
  ProposalPrivacy,
  ProposalVotingProtocolType,
} from "@/src/services/proposalApi";
import type { Community } from "@/src/services/communityApi";
import { useDeployPoll, getEthersSigner, votingMechanismToMode } from "@/src/hooks/useDeployPoll";
import { deployPolicyContract } from "@/src/services/policyDeploy";
import { decodeContractError } from "@/src/lib/decodeContractError";
import { useSiwe } from "@/src/hooks/useSiwe";
import { withAuthDetect } from "@/src/services/httpClient";
import { GovernanceTypes, PolicyType, type SignUpPolicyType, type PollDeployConfig } from "@/src/config";
import {
  POLICY_TYPE_OPTIONS,
  DEFAULT_POLICY_INPUTS,
  buildPolicyArgs,
  PolicyArgsFields,
  type PolicyInputState,
} from "./PolicyArgsFields";

export function policyIdToType(id: number): SignUpPolicyType | undefined {
  const entry = Object.entries(PolicyType).find(([, value]) => Number(value) === id);
  return entry?.[0] as SignUpPolicyType | undefined;
}

const DECISION_TARGET_TYPE_OPTIONS: { value: ProposalDecisionTargetType; label: string }[] = [
  { value: "policy", label: "Policy — a binding decision on a proposal or rule" },
  { value: "opinion", label: "Opinion — a non-binding survey or straw poll" },
  { value: "person", label: "Person — an election, electing someone to a role" },
];

/** Person-type (election) proposals only — options and optionMemberAddresses must stay
 * index-aligned, so blanks are filtered from both arrays TOGETHER, not independently (a blank
 * option removed from the middle would otherwise silently pair the wrong address with the wrong
 * remaining option). Matches useDeployPoll.ts's own `options.filter((o) => o.trim() !== "")`
 * blank-detection rule exactly, so the on-chain deployed option list and this stay aligned. */
export function buildElectionOptionPairs(
  options: string[],
  optionMemberAddresses: string[],
): { options: string[]; optionMemberAddresses: string[] } {
  const pairs = options
    .map((option, i) => ({ option, memberAddress: optionMemberAddresses[i] ?? "" }))
    .filter((pair) => pair.option.trim() !== "");
  return {
    options: pairs.map((pair) => pair.option),
    optionMemberAddresses: pairs.map((pair) => pair.memberAddress),
  };
}

const TALLY_MECHANISM_OPTIONS: { value: ProposalVotingProtocolType; label: string }[] = [
  { value: "simple", label: "Simple Majority" },
  { value: "quadratic", label: "Quadratic Voting" },
  { value: "ranked", label: "Ranked Choice" },
  { value: "full", label: "Full Voting" },
];

interface CreateProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  communityId: string;
  /** When true, this community skips the draft/co-sponsorship stage entirely (specs/007) — the
   * modal collects deploy-time fields up front and deploys in one step instead of creating a draft. */
  directDeploymentEnabled?: boolean;
  /** Required to actually deploy on-chain when directDeploymentEnabled is true; null/undefined means
   * this community has no linked on-chain governance contract yet (FR-006). */
  pollDeployConfig?: PollDeployConfig | null;
  /** Needed to build the eligibility policy picker below (allowedPolicies). */
  community?: Community;
}

export function CreateProposalModal({
  isOpen,
  onClose,
  onSuccess,
  communityId,
  directDeploymentEnabled = false,
  pollDeployConfig,
  community,
}: CreateProposalModalProps) {
  const chainId = useChainId();
  const { signOut } = useSiwe();
  const { data: tiers = [] } = useQuery({
    queryKey: ["tiers", communityId],
    queryFn: () => membershipApi.getTiers(communityId),
    enabled: isOpen,
  });
  const votingTiers = tiers.filter((t) => t.canVote);

  // Credential wedge (2026-08-29 /plan-eng-review, E0) — a display-only approximation of the
  // backend's hasRequiredCredential check (which is the real security boundary, re-checked on
  // submit), so the submit button and message match what the server will actually decide.
  const { data: membershipStatus } = useQuery({
    queryKey: ["membershipStatus", communityId],
    queryFn: () => membershipApi.getMembershipStatus(communityId),
    enabled: isOpen,
  });
  const myTier = tiers.find((t) => t.label === membershipStatus?.tierLabel);
  const { data: myCredentials = [] } = useQuery({
    queryKey: ["credentials"],
    queryFn: () => credentialApi.list(),
    enabled: isOpen,
  });
  const credentialBlocked =
    !!myTier?.requiresCredential &&
    myCredentials.find((c) => c.protocol === myTier.requiresCredential)?.status !== "verified";

  // Governance restructure Phase 2 (2026-08-20) — "person"-type (election) proposals are
  // direct-deploy only (see ENGINEERING.md's Decisions Log); the member picker they need only
  // fetches once that target type is actually selected, not on every modal open.
  const [decisionTargetType, setDecisionTargetType] = useState<ProposalDecisionTargetType>("policy");
  const { data: members = [] } = useQuery({
    queryKey: ["members", communityId],
    queryFn: () => membershipApi.listMembers(communityId),
    enabled: isOpen && directDeploymentEnabled && decisionTargetType === "person",
  });

  const allowedPolicyTypes = (community?.allowedPolicies ?? [])
    .map(policyIdToType)
    .filter((t): t is SignUpPolicyType => !!t);

  // Each community's MACI contract only accepts a subset of tally mechanisms (see MACI.sol's
  // supportedModes allow-list) — offering an unsupported one here reverts with UnsupportedMode()
  // on deploy, so filter to what this community actually supports.
  const supportedModes = community?.supportedModes ?? [];
  const allowedTallyOptions =
    supportedModes.length > 0
      ? TALLY_MECHANISM_OPTIONS.filter((opt) => supportedModes.includes(votingMechanismToMode(opt.value)))
      : TALLY_MECHANISM_OPTIONS;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacy] = useState<ProposalPrivacy>("privacy_preserving");
  const [executionLocation] = useState<ProposalExecutionLocation>("onchain");
  const [votingProtocolType, setVotingProtocolType] = useState<ProposalVotingProtocolType>(
    allowedTallyOptions[0]?.value ?? "simple",
  );
  const [eligibilityPolicyType, setEligibilityPolicyType] = useState<SignUpPolicyType>(
    allowedPolicyTypes[0] ?? "FreeForAll",
  );
  const [newPolicyInputs, setNewPolicyInputs] = useState<PolicyInputState>(DEFAULT_POLICY_INPUTS);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [options, setOptions] = useState(["", ""]);
  // "person"-type only — same index as `options`, kept in sync on every add/remove so option[i]
  // always pairs with optionMemberAddresses[i] (outside-voice-caught risk during the Phase 2 eng
  // review: independently filtering the two arrays before submission would let a blank option
  // removed from the middle silently desync them — see buildElectionOptionPairs below).
  const [optionMemberAddresses, setOptionMemberAddresses] = useState(["", ""]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { deployPoll } = useDeployPoll(GovernanceTypes.MACI);

  if (!isOpen) return null;

  const newPolicyArgs = buildPolicyArgs(eligibilityPolicyType, newPolicyInputs);
  const eligibilityPolicyReady = !directDeploymentEnabled || newPolicyArgs !== null;

  const filledOptionCount = options.filter((o) => o.trim() !== "").length;
  const electionPairs = buildElectionOptionPairs(options, optionMemberAddresses);
  // Person-type elections need every remaining candidate to have a picked, distinct member —
  // client-side check for a fast, clear error; the backend enforces the same rule regardless.
  const electionOptionsReady =
    decisionTargetType !== "person" ||
    (electionPairs.optionMemberAddresses.every((address) => address !== "") &&
      new Set(electionPairs.optionMemberAddresses.map((address) => address.toLowerCase())).size ===
        electionPairs.optionMemberAddresses.length);
  const directModeReady =
    !directDeploymentEnabled ||
    (!!startDate && !!endDate && filledOptionCount >= 2 && eligibilityPolicyReady && electionOptionsReady);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setEligibilityPolicyType(allowedPolicyTypes[0] ?? "FreeForAll");
    setNewPolicyInputs(DEFAULT_POLICY_INPUTS);
    setStartDate("");
    setEndDate("");
    setOptions(["", ""]);
    setOptionMemberAddresses(["", ""]);
    setDecisionTargetType("policy");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!directDeploymentEnabled && votingTiers.length === 0) {
      setError("This community has no voting-capable tiers yet.");
      return;
    }

    setIsSubmitting(true);
    try {
      // /plan-eng-review (2026-08-23) Batch 3 — one withAuthDetect wrap around the whole submit
      // sequence, matching edit/page.tsx's Batch 2 precedent: authorizeDirect/confirmDirect (or
      // createDraft) are one atomic "submit this proposal" action from the user's perspective,
      // sharing one catch/one error state, so a 401 anywhere in it signs out exactly once.
      await withAuthDetect(async () => {
        if (directDeploymentEnabled && pollDeployConfig) {
          // The backend's checkVoteEligibility (used for the "Vote" button badge) still gates on
          // eligibleTierIds regardless of creation path — the UI no longer asks for tiers here
          // since the real gate is now the on-chain eligibility policy below, so every
          // voting-capable tier is recorded automatically rather than picked manually.
          const directEligibleTierIds = votingTiers.map((t) => t.id);

          await proposalApi.authorizeDirect(communityId, {
            title,
            description,
            privacy,
            executionLocation,
            votingProtocolType,
            eligibleTierIds: directEligibleTierIds,
            decisionTargetType,
            ...(decisionTargetType === "person" ? electionPairs : {}),
          });

          if (!newPolicyArgs) throw new Error("Fill in all required eligibility policy fields");
          const signer = await getEthersSigner();
          const policyAddress = await deployPolicyContract(newPolicyArgs, signer, chainId);

          const { pollAddress, pollId, txHash } = await deployPoll({
            maciAddress: communityId,
            pollDeployConfig,
            existingPollAddress: null,
            policyAddress,
            formData: {
              title,
              description,
              votingMechanism: votingProtocolType,
              startDate,
              endDate,
              eligibility: eligibilityPolicyType,
              options,
            },
          });
          await proposalApi.confirmDirect(communityId, {
            title,
            description,
            privacy,
            executionLocation,
            votingProtocolType,
            eligibleTierIds: directEligibleTierIds,
            pollAddress,
            pollId,
            txHash,
            pollStartDate: Math.floor(new Date(startDate).getTime() / 1000),
            pollEndDate: Math.floor(new Date(endDate).getTime() / 1000),
            decisionTargetType,
            options: electionPairs.options,
            ...(decisionTargetType === "person" ? { optionMemberAddresses: electionPairs.optionMemberAddresses } : {}),
          });
        } else {
          // Mirrors the direct-deploy branch above (specs/010 research.md #11): this poll's real
          // eligibility gate is the on-chain policy chosen later, at deploy time (DeployPollPrompt)
          // — not chosen yet here — so every voting-capable tier is recorded automatically rather
          // than asking the user to guess eligibility before that policy exists.
          await proposalApi.createDraft(communityId, {
            title,
            description,
            privacy,
            executionLocation,
            votingProtocolType,
            eligibleTierIds: votingTiers.map((t) => t.id),
          });
        }
      }, signOut);
      resetForm();
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(decodeContractError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-2xl w-full my-8 max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-700 flex items-center justify-between sticky top-0 bg-gray-900 rounded-t-2xl z-10">
          <h2 className="text-2xl font-bold text-foreground">Create Governance Action</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {directDeploymentEnabled && !pollDeployConfig ? (
          <div className="p-8 space-y-6">
            <p className="text-sm text-amber-400 bg-amber-900/20 border border-amber-700/40 rounded-lg p-4">
              On-chain deployment isn't linked for this community yet.
            </p>
            <button
              onClick={onClose}
              className="px-6 py-3 border-2 border-gray-600 rounded-lg font-semibold hover:bg-gray-800 text-foreground"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-8 space-y-8">
            {credentialBlocked && (
              <div className="p-4 bg-amber-900/20 border border-amber-700/40 rounded-lg space-y-2">
                <p className="text-sm text-amber-400">
                  Your tier ({myTier?.label}) requires a verified{" "}
                  {myTier?.requiresCredential === "zupass" ? "Zupass" : "zkID"} credential to create governance actions.
                </p>
                <Link to="/manage-profile" className="text-sm font-medium text-accent-hover hover:underline">
                  Verify your credential →
                </Link>
              </div>
            )}

            <div>
              <label htmlFor="governance-action-title" className="block text-sm font-semibold text-foreground mb-3">
                Title *
              </label>
              <input
                id="governance-action-title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-base text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            <div>
              <label
                htmlFor="governance-action-description"
                className="block text-sm font-semibold text-foreground mb-3"
              >
                Description *
              </label>
              <textarea
                id="governance-action-description"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-base text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-foreground mb-3">Privacy</label>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-3 p-4 border-2 border-accent bg-accent/10 rounded-lg">
                  <input type="radio" checked readOnly className="w-5 h-5" />
                  <span className="font-semibold text-foreground">Privacy-preserving</span>
                </div>
                <div
                  className="flex items-center gap-3 p-4 border-2 border-gray-800 bg-gray-800/40 rounded-lg opacity-50 cursor-not-allowed"
                  title="Coming soon"
                >
                  <input type="radio" disabled className="w-5 h-5" />
                  <div>
                    <span className="font-semibold text-foreground">Public</span>
                    <p className="text-xs text-gray-400">Coming soon</p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-foreground mb-3">Execution Location</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="flex items-center gap-3 p-4 border-2 border-accent bg-accent/10 rounded-lg">
                  <input type="radio" checked readOnly className="w-5 h-5" />
                  <span className="font-semibold text-foreground">Onchain</span>
                </div>
                {["Offchain", "Hybrid"].map((label) => (
                  <div
                    key={label}
                    className="flex items-center gap-3 p-4 border-2 border-gray-800 bg-gray-800/40 rounded-lg opacity-50 cursor-not-allowed"
                    title="Coming soon"
                  >
                    <input type="radio" disabled className="w-5 h-5" />
                    <div>
                      <span className="font-semibold text-foreground">{label}</span>
                      <p className="text-xs text-gray-400">Coming soon</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-foreground mb-3">Tally Mechanism *</label>
              <select
                value={votingProtocolType}
                onChange={(e) => setVotingProtocolType(e.target.value as ProposalVotingProtocolType)}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-base text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {allowedTallyOptions.length === 0 && <option value="">No supported tally mechanisms configured</option>}
                {allowedTallyOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
                <option value="weighted" disabled>
                  Weighted (coming soon)
                </option>
              </select>
            </div>

            {!directDeploymentEnabled && (
              <div>
                <p className="text-sm text-gray-400">
                  Every voting-capable tier ({votingTiers.map((t) => t.label).join(", ") || "none yet"}) will be able to
                  vote once this poll is deployed — the actual eligibility gate is the on-chain policy chosen at deploy
                  time.
                </p>
              </div>
            )}

            {directDeploymentEnabled && (
              <div className="space-y-4 p-4 border-2 border-accent/40 bg-accent/10 rounded-lg">
                <p className="text-sm font-semibold text-foreground">
                  This community deploys polls directly — no draft or co-sponsorship needed.
                </p>

                <div>
                  <label htmlFor="proposal-decision-type" className="block text-sm font-semibold text-foreground mb-3">
                    Decision Type
                  </label>
                  <select
                    id="proposal-decision-type"
                    value={decisionTargetType}
                    onChange={(e) => setDecisionTargetType(e.target.value as ProposalDecisionTargetType)}
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-base text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    {DECISION_TARGET_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-foreground mb-3">Eligibility Policy *</label>
                  <p className="text-xs text-gray-400 mb-2">Who can vote on this poll, enforced on-chain.</p>
                  <select
                    value={eligibilityPolicyType}
                    onChange={(e) => setEligibilityPolicyType(e.target.value as SignUpPolicyType)}
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-base text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    {allowedPolicyTypes.length === 0 && <option value="">No allowed policies configured</option>}
                    {allowedPolicyTypes.map((type) => (
                      <option key={type} value={type}>
                        {POLICY_TYPE_OPTIONS.find((p) => p.type === type)?.label ?? type}
                      </option>
                    ))}
                  </select>

                  <PolicyArgsFields
                    policyType={eligibilityPolicyType}
                    inputs={newPolicyInputs}
                    updateInput={(key, value) => setNewPolicyInputs((prev) => ({ ...prev, [key]: value }))}
                    theme="dark"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="poll-start-date" className="block text-xs font-semibold text-gray-300 mb-1">
                      Start Date *
                    </label>
                    <input
                      id="poll-start-date"
                      type="datetime-local"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <label htmlFor="poll-end-date" className="block text-xs font-semibold text-gray-300 mb-1">
                      End Date *
                    </label>
                    <input
                      id="poll-end-date"
                      type="datetime-local"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">
                    {decisionTargetType === "person" ? "Candidates * (at least 2)" : "Options * (at least 2)"}
                  </label>
                  <div className="space-y-2">
                    {options.map((option, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          type="text"
                          value={option}
                          placeholder={decisionTargetType === "person" ? `Candidate label ${i + 1}` : `Option ${i + 1}`}
                          onChange={(e) => setOptions(options.map((o, j) => (j === i ? e.target.value : o)))}
                          className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                        {decisionTargetType === "person" && (
                          <select
                            value={optionMemberAddresses[i] ?? ""}
                            onChange={(e) =>
                              setOptionMemberAddresses(
                                optionMemberAddresses.map((a, j) => (j === i ? e.target.value : a)),
                              )
                            }
                            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                          >
                            <option value="">Pick a member…</option>
                            {members.map((m) => (
                              <option key={m.walletAddress} value={m.walletAddress}>
                                {m.walletAddress.slice(0, 6)}…{m.walletAddress.slice(-4)} ({m.tierLabel})
                              </option>
                            ))}
                          </select>
                        )}
                        {options.length > 2 && (
                          <button
                            type="button"
                            onClick={() => {
                              setOptions(options.filter((_, j) => j !== i));
                              setOptionMemberAddresses(optionMemberAddresses.filter((_, j) => j !== i));
                            }}
                            className="px-3 py-2 text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setOptions([...options, ""]);
                        setOptionMemberAddresses([...optionMemberAddresses, ""]);
                      }}
                      className="w-full px-3 py-2 border-2 border-dashed border-gray-600 rounded-lg text-sm text-gray-400 hover:border-accent hover:text-accent-hover transition-colors font-medium"
                    >
                      + Add {decisionTargetType === "person" ? "Candidate" : "Option"}
                    </button>
                    {decisionTargetType === "person" && !electionOptionsReady && filledOptionCount >= 2 && (
                      <p className="text-xs text-amber-400">
                        Every candidate needs a picked, distinct member before you can submit.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-900/20 border border-red-600/50 rounded-lg">
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            <div className="flex gap-4 pt-6 border-t border-gray-700">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 px-6 py-3 border-2 border-gray-600 rounded-lg font-semibold hover:bg-gray-800 text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !directModeReady || credentialBlocked}
                className="flex-1 px-6 py-3 bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-60"
              >
                {isSubmitting
                  ? directDeploymentEnabled
                    ? "Deploying..."
                    : "Creating..."
                  : directDeploymentEnabled
                    ? "Deploy Poll"
                    : "Create Draft"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
