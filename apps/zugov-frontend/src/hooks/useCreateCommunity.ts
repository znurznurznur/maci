import { useState, useCallback, useEffect, useRef } from "react";
import { useAccount, useChainId } from "wagmi";
import { Contract, ContractFactory, type Signer } from "ethers";
import type { Hex } from "viem";
import { MACI__factory } from "@maci-protocol/contracts/typechain-types";
import { generateEmptyBallotRoots } from "@maci-protocol/sdk";
import { PublicKey } from "@maci-protocol/domainobjs";
import { FIXED_POLL_DEPLOY_CONSTANTS, appConstants, type PollDeployConfig, type SignUpPolicyArgs } from "@/src/config";
import { STATE_TREE_DEPTH } from "@/src/constants";
import { deployPolicyContract, SET_TARGET_ABI } from "@/src/services/policyDeploy";
import { getSignerFromWagmiConfig } from "@/src/services/wagmiSigner";
import { wagmiConfig } from "@/src/services/wagmiConfig";
import {
  savePendingCheckpoint,
  getPendingCheckpoint,
  clearPendingCheckpoint,
  type DeployPhase,
  type MACIDeploymentConfig,
  type MembershipPolicy,
  type PendingDeploymentCheckpoint,
  type TierDraft,
} from "@/src/services/checkpointStore";

// Default role set for the communities-first wizard (design review Pass 7): "Resident" and
// "Organizer" are plain-language presets over the existing tier permission flags, not a new
// permission model. Organizer can manage membership so they can approve join requests under
// the "approval-required" membership policy below.
// Frozen: this is a shared module-level default, not a per-call fresh object. Every community
// creation reads the same reference — mutating it (e.g. accidentally in a future edit) would
// silently corrupt the default tiers for every subsequent wizard run in the same session.
// Still the starting point offered to a creator in the tier-editor step (2026-08-19
// community-creation-rework review, D3) — now editable rather than fixed.
export const RESIDENT_ORGANIZER_TIERS: TierDraft[] = Object.freeze([
  Object.freeze({
    label: "Resident",
    canCreateProposals: false,
    canVote: true,
    canManageMembership: false,
    canCreateEvents: true,
    requiresCredential: null,
  }),
  Object.freeze({
    label: "Organizer",
    canCreateProposals: true,
    canVote: true,
    canManageMembership: true,
    canCreateEvents: true,
    requiresCredential: null,
  }),
]) as TierDraft[];

// Sensible zero-config defaults for the collapsed Advanced section — FreeForAll is the only
// sign-up policy actually deployed on Sepolia today (see TODOS.md: MerkleProof factory isn't
// deployed yet), and NON_QV is the simplest, most broadly understandable voting style. Frozen
// for the same reason as RESIDENT_ORGANIZER_TIERS above — this is a shared reference, not a
// fresh object per call. Also the default used for a standalone "Deploy governance now" flow
// (edit page) where there's no Advanced-settings UI to collect a custom choice from.
const DEFAULT_ADVANCED_CONFIG: Pick<MACIDeploymentConfig, "signUpPolicy" | "allowedPolicies" | "supportedModes"> =
  Object.freeze({
    signUpPolicy: Object.freeze({ type: "FreeForAll" }),
    allowedPolicies: Object.freeze([1]),
    supportedModes: Object.freeze([1]),
  }) as Pick<MACIDeploymentConfig, "signUpPolicy" | "allowedPolicies" | "supportedModes">;

export { DEFAULT_ADVANCED_CONFIG };
export type { DeployPhase };
import * as communityApi from "@/src/services/communityApi";
import { useSiwe } from "@/src/hooks/useSiwe";
import { isAuthError } from "@/src/services/httpClient";
import { useZuGovRegistry, type RegistryStatus, type RegistryData } from "./useZuGovRegistry";

export type WizardStep = "community_info" | "community_setup" | "success";

export interface DeploymentSummary {
  displayName: string;
  description: string;
  signUpPolicyType: string;
  allowedPolicies: number[];
  supportedModes: number[];
  stateTreeDepth: 10;
  deployerAddress: Hex;
  chainName: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const ALL_PHASES: DeployPhase[] = ["deploy_sign_up_policy", "deploy_maci", "set_target", "save_community"];

// ─── Helpers ───────────────────────────────────────────────────────────────

async function getEthersSigner(): Promise<Signer> {
  return getSignerFromWagmiConfig(wagmiConfig);
}

/**
 * Every value here is a known, static, per-chain constant today — no new on-chain deployment or
 * dynamic computation (research.md #1). The registry-derived coordinator key is read live via
 * `registryData` (the same on-chain `getInfrastructure()` read already used for the MACI
 * deployment step above), rather than a separately-sourced generated-config copy, so this can
 * never drift from what's actually configured on-chain.
 */
export function buildPollDeployConfig(
  registryData: RegistryData,
  chainConstants: (typeof appConstants)[keyof typeof appConstants],
): PollDeployConfig {
  return {
    coordinatorPublicKey: new PublicKey([registryData.coordinatorPubKeyX, registryData.coordinatorPubKeyY]).serialize(),
    treeDepths: {
      tallyProcessingStateTreeDepth: FIXED_POLL_DEPLOY_CONSTANTS.tallyProcessingStateTreeDepth,
      voteOptionTreeDepth: FIXED_POLL_DEPLOY_CONSTANTS.voteOptionTreeDepth,
      stateTreeDepth: STATE_TREE_DEPTH,
    },
    messageBatchSize: FIXED_POLL_DEPLOY_CONSTANTS.messageBatchSize,
    freeForAllPolicyFactory: chainConstants.policyFactories.freeForAll.policy,
    freeForAllChecker: chainConstants.freeForAllChecker,
    constantVoiceCreditProxyFactory: chainConstants.constantVoiceCreditProxyFactory,
    initialVoiceCreditAmount: FIXED_POLL_DEPLOY_CONSTANTS.initialVoiceCreditAmount,
  };
}

function linkPoseidon(bytecode: string, registry: RegistryData): string {
  const strip = (addr: string) => addr.replace(/^0x/, "").toLowerCase().padStart(40, "0");
  return bytecode
    .replace(new RegExp("__\\$6574937f64fc1d7710ec0e28b7a36713bb\\$__", "g"), strip(registry.poseidonT3))
    .replace(new RegExp("__\\$dc01a9744591ab014bc46a3b7671cdaefb\\$__", "g"), strip(registry.poseidonT4))
    .replace(new RegExp("__\\$ce9c2c925f157047e54fa833ec4e61409f\\$__", "g"), strip(registry.poseidonT5))
    .replace(new RegExp("__\\$20527677031d76601747626a9845039fe4\\$__", "g"), strip(registry.poseidonT6));
}

// SIWE fix (2026-08-19 community-creation-rework review, D4, corrected post-outside-voice): on
// an AuthError, invalidate the shared session and fail immediately — do NOT silently re-sign-in
// and retry. Silently retrying is exactly the "asks to sign in again with no explanation" bug:
// the wallet-signature popup would fire with zero warning. signOut() flips the shared SiweGate
// instance to unauthenticated, which makes its prompt reappear; the human then clicks "Sign in
// with Ethereum" themselves and retries the action manually, matching
// manage-communities/register/page.tsx's already-correct pattern exactly. Non-auth failures
// (network blips, RPC errors) keep the original backoff-retry — that resilience is unrelated to
// the SIWE bug and stays in scope.
async function withAuthRetry<T>(action: () => Promise<T>, signOut: () => Promise<void>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await action();
    } catch (err) {
      if (isAuthError(err)) {
        await signOut();
        throw err;
      }
      if (attempt === 2) throw err;
      await new Promise<void>((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw new Error("Unreachable");
}

export async function saveIdentityWithRetry(
  payload: communityApi.IdentityPayload,
  signOut: () => Promise<void>,
): Promise<communityApi.Community> {
  return withAuthRetry(() => communityApi.registerIdentity(payload), signOut);
}

export async function saveWithRetry(
  identityCommunityId: string,
  payload: communityApi.GovernancePayload,
  signOut: () => Promise<void>,
): Promise<communityApi.Community> {
  return withAuthRetry(() => communityApi.attachGovernance(identityCommunityId, payload), signOut);
}

function getCompletedPhasesFromCheckpoint(lastPhase: DeployPhase | undefined): DeployPhase[] {
  if (!lastPhase) return [];
  const idx = ALL_PHASES.indexOf(lastPhase);
  return idx >= 0 ? ALL_PHASES.slice(0, idx + 1) : [];
}

// ─── useDeployGovernance ───────────────────────────────────────────────────
//
// The on-chain deploy sequence (sign-up policy -> MACI -> set target -> attach governance),
// extracted so it's usable from two entry points with one implementation (2026-08-19
// community-creation-rework review, D1):
//   1. CreateCommunityWizard, right after identity creation, for a just-created community.
//   2. community/[id]/settings (relocated from manage-communities/[id]/edit, Child C1,
//      /plan-eng-review 2026-08-24), any time later, for an already-existing off-chain
//      community — the "deploy governance later" path that makes "governance not set" a real,
//      recoverable state instead of a trap.
//
// communityId is nullable so the wizard can call this hook unconditionally on every render
// (React's rules of hooks) even before identity creation has produced a real id — every action
// below no-ops with a clear error until communityId is set.

export interface DeployGovernanceConfig {
  displayName: string;
  signUpPolicy: SignUpPolicyArgs;
  allowedPolicies: number[];
  supportedModes: number[];
}

export interface DeployGovernanceState {
  registryStatus: RegistryStatus | undefined;
  summary: DeploymentSummary | undefined;
  currentPhase: DeployPhase | undefined;
  completedPhases: DeployPhase[];
  currentTxHash: Hex | undefined;
  errorMessage: string | undefined;
  retryFromPhase: DeployPhase | undefined;
  isDeployed: boolean;
}

export interface UseDeployGovernanceResult {
  state: DeployGovernanceState;
  startNetworkCheck: () => Promise<void>;
  startDeployment: () => Promise<void>;
  retryDeployment: () => Promise<void>;
  saveCommunity: () => Promise<void>;
}

const DEPLOY_INITIAL_STATE: DeployGovernanceState = {
  registryStatus: undefined,
  summary: undefined,
  currentPhase: undefined,
  completedPhases: [],
  currentTxHash: undefined,
  errorMessage: undefined,
  retryFromPhase: undefined,
  isDeployed: false,
};

export function useDeployGovernance(
  communityId: string | undefined,
  config: DeployGovernanceConfig | undefined,
  siwe: ReturnType<typeof useSiwe>,
): UseDeployGovernanceResult {
  const { address } = useAccount();
  const chainId = useChainId();
  const registry = useZuGovRegistry();
  const [state, setState] = useState<DeployGovernanceState>(DEPLOY_INITIAL_STATE);
  const deployingRef = useRef(false);

  // Wallet-switch guard (2026-08-19 review, D7 — outside-voice finding): runDeployment reads
  // `address` once at call-time (a safe closure snapshot for that single invocation), but
  // without this ref, a resident switching wallets mid-deploy would have their next
  // retry/resume attempt silently proceed under the new address — orphaning the old wallet's
  // checkpoint while an already-deployed contract stays owned by the old address. addressRef
  // always reflects the LIVE connected wallet, independent of any in-flight closure, so a
  // running deploy can detect the mismatch and stop instead of silently continuing wrong.
  const addressRef = useRef(address);
  useEffect(() => {
    addressRef.current = address;
  }, [address]);

  const startNetworkCheck = useCallback(async () => {
    await registry.refetch();
    setState((prev) => ({ ...prev, registryStatus: registry }));
  }, [registry]);

  const runDeployment = useCallback(
    async (fromPhase: DeployPhase | undefined, existingCheckpoint?: PendingDeploymentCheckpoint) => {
      if (deployingRef.current) return;
      if (!communityId) throw new Error("No community to deploy governance for");
      if (!address) throw new Error("Wallet not connected");
      if (!registry.data) throw new Error("Registry data not available");
      if (!config) throw new Error("Deployment config not available");

      const deployAddress = address;
      const assertWalletUnchanged = () => {
        if (addressRef.current !== deployAddress) {
          throw new Error(`Wallet changed. Reconnect ${deployAddress} to continue this deploy.`);
        }
      };

      const registryData = registry.data;
      const chainConstants = appConstants[chainId as keyof typeof appConstants];
      const chainName = chainConstants?.chain.name ?? String(chainId);

      deployingRef.current = true;

      setState((prev) => ({ ...prev, errorMessage: undefined, retryFromPhase: undefined }));

      const fullConfig: MACIDeploymentConfig = {
        displayName: config.displayName,
        description: "",
        signUpPolicy: config.signUpPolicy,
        allowedPolicies: config.allowedPolicies,
        supportedModes: config.supportedModes,
        stateTreeDepth: STATE_TREE_DEPTH,
        membershipPolicy: "open",
        tierChangesRequireVote: false,
        tiers: [],
        defaultTierLabel: "",
      };

      const checkpoint: PendingDeploymentCheckpoint = existingCheckpoint ?? {
        config: fullConfig,
        lastPhase: "deploy_sign_up_policy",
        identityCommunityId: communityId,
        chainId,
        startedAt: Date.now(),
      };

      try {
        const signer = await getEthersSigner();
        let signUpPolicyAddress: Hex | undefined = checkpoint.deployedSignUpPolicyAddress;
        let maciAddress: Hex | undefined = checkpoint.deployedMaciAddress;
        let maciBlockNumber: number | undefined = checkpoint.deployedMaciBlockNumber;

        // Phase 1: Deploy sign-up policy
        if (!fromPhase || fromPhase === "deploy_sign_up_policy") {
          assertWalletUnchanged();
          setState((prev) => ({ ...prev, currentPhase: "deploy_sign_up_policy" }));
          signUpPolicyAddress = await deployPolicyContract(config.signUpPolicy, signer, chainId);
          assertWalletUnchanged();
          checkpoint.deployedSignUpPolicyAddress = signUpPolicyAddress;
          checkpoint.lastPhase = "deploy_sign_up_policy";
          savePendingCheckpoint(deployAddress as Hex, communityId, checkpoint);
          setState((prev) => ({ ...prev, completedPhases: [...prev.completedPhases, "deploy_sign_up_policy"] }));
        }

        if (!signUpPolicyAddress) throw new Error("Sign-up policy address missing");

        // Phase 2: Deploy MACI
        if (!fromPhase || fromPhase === "deploy_sign_up_policy" || fromPhase === "deploy_maci") {
          assertWalletUnchanged();
          setState((prev) => ({ ...prev, currentPhase: "deploy_maci" }));
          const emptyBallotRoots = generateEmptyBallotRoots(STATE_TREE_DEPTH).slice(0, 5) as [
            bigint,
            bigint,
            bigint,
            bigint,
            bigint,
          ];
          const linkedBytecode = linkPoseidon(MACI__factory.bytecode, registryData);
          const maciFactory = new ContractFactory(MACI__factory.abi, linkedBytecode, signer);
          const maciContract = await maciFactory.deploy({
            pollFactory: registryData.pollFactory,
            messageProcessorFactory: registryData.messageProcessorFactory,
            tallyFactory: registryData.tallyFactory,
            signUpPolicy: signUpPolicyAddress,
            verifier: registryData.verifier,
            verifyingKeysRegistry: registryData.verifyingKeysRegistry,
            stateTreeDepth: STATE_TREE_DEPTH,
            emptyBallotRoots,
            owner: deployAddress,
            initialSupportedModes: config.supportedModes,
            initialAllowedPolicies: config.allowedPolicies,
          });
          const maciReceipt = (await maciContract.deploymentTransaction()?.wait()) as {
            status: number;
            hash: string;
            blockNumber: number;
          } | null;
          if (!maciReceipt || maciReceipt.status !== 1) throw new Error("MACI deployment failed");
          assertWalletUnchanged();

          maciAddress = (await maciContract.getAddress()) as Hex;
          maciBlockNumber = maciReceipt.blockNumber;
          setState((prev) => ({ ...prev, currentTxHash: maciReceipt.hash as Hex }));
          checkpoint.deployedMaciAddress = maciAddress;
          checkpoint.deployedMaciBlockNumber = maciBlockNumber;
          checkpoint.lastPhase = "deploy_maci";
          savePendingCheckpoint(deployAddress as Hex, communityId, checkpoint);
          setState((prev) => ({ ...prev, completedPhases: [...prev.completedPhases, "deploy_maci"] }));
        }

        if (!maciAddress) throw new Error("MACI address missing");
        if (maciBlockNumber === undefined) throw new Error("MACI deployment block missing");

        // Phase 3: Set target (authorize MACI on the sign-up policy)
        if (
          !fromPhase ||
          fromPhase === "deploy_sign_up_policy" ||
          fromPhase === "deploy_maci" ||
          fromPhase === "set_target"
        ) {
          assertWalletUnchanged();
          setState((prev) => ({ ...prev, currentPhase: "set_target" }));
          const policy = new Contract(signUpPolicyAddress, SET_TARGET_ABI, signer);
          const setTargetTx = await (
            policy.setTarget as (addr: string) => Promise<{
              wait: () => Promise<{
                status: number;
              }>;
            }>
          )(maciAddress);
          const setTargetReceipt = await setTargetTx.wait();
          if (!setTargetReceipt || setTargetReceipt.status !== 1) throw new Error("setTarget failed");
          assertWalletUnchanged();
          checkpoint.lastPhase = "set_target";
          savePendingCheckpoint(deployAddress as Hex, communityId, checkpoint);
          setState((prev) => ({ ...prev, completedPhases: [...prev.completedPhases, "set_target"] }));
        }

        // Phase 4: attach governance config now that MACI has been deployed on-chain — identity
        // (displayName/description/membership/tiers) already exists, created either by the
        // wizard's community_setup step or long before, for an existing off-chain community.
        assertWalletUnchanged();
        setState((prev) => ({ ...prev, currentPhase: "save_community" }));
        const payload: communityApi.GovernancePayload = {
          contractAddress: maciAddress,
          chainId,
          allowedPolicies: config.allowedPolicies,
          supportedModes: config.supportedModes,
          signUpPolicyType: config.signUpPolicy.type,
          signUpPolicyAddress: signUpPolicyAddress,
          maciDeploymentBlock: maciBlockNumber,
          stateTreeDepth: STATE_TREE_DEPTH,
          pollDeployConfig: chainConstants ? buildPollDeployConfig(registryData, chainConstants) : undefined,
        };

        const registered = await saveWithRetry(communityId, payload, siwe.signOut);
        setState((prev) => ({ ...prev, completedPhases: [...prev.completedPhases, "save_community"] }));

        clearPendingCheckpoint(deployAddress as Hex, communityId);

        window.dispatchEvent(
          new CustomEvent("zugov:community-created", {
            detail: {
              community: registered,
              signUpPolicyType: config.signUpPolicy.type,
              signUpPolicyAddress,
            },
          }),
        );

        setState((prev) => ({
          ...prev,
          isDeployed: true,
          currentPhase: undefined,
          summary: {
            displayName: config.displayName,
            description: "",
            signUpPolicyType: config.signUpPolicy.type,
            allowedPolicies: config.allowedPolicies,
            supportedModes: config.supportedModes,
            stateTreeDepth: STATE_TREE_DEPTH,
            deployerAddress: deployAddress as Hex,
            chainName,
          },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          errorMessage: message,
          retryFromPhase: prev.currentPhase,
          currentPhase: undefined,
        }));
      } finally {
        deployingRef.current = false;
      }
    },
    [address, chainId, communityId, config, registry, siwe],
  );

  const startDeployment = useCallback(async () => {
    await runDeployment(undefined);
  }, [runDeployment]);

  const retryDeployment = useCallback(async () => {
    const checkpoint = address && communityId ? getPendingCheckpoint(address as Hex, communityId) : null;
    await runDeployment(state.retryFromPhase, checkpoint ?? undefined);
  }, [runDeployment, state.retryFromPhase, address, communityId]);

  const saveCommunity = useCallback(async () => {
    const checkpoint = address && communityId ? getPendingCheckpoint(address as Hex, communityId) : null;
    await runDeployment("save_community", checkpoint ?? undefined);
  }, [runDeployment, address, communityId]);

  const registryForState: RegistryStatus = {
    isLoading: registry.isLoading,
    isSupported: registry.isSupported,
    isReady: registry.isReady,
    data: registry.data,
    error: registry.error,
  };

  return {
    state: { ...state, registryStatus: registryForState },
    startNetworkCheck,
    startDeployment,
    retryDeployment,
    saveCommunity,
  };
}

// ─── useCreateCommunity (wizard) ───────────────────────────────────────────

export interface WizardState {
  step: WizardStep;
  config: Partial<MACIDeploymentConfig>;
  // The community's identity id (server-generated UUID), created at the community_setup step
  // — before any on-chain deployment starts (Architecture 1A/1B). Governance restructure Phase 1
  // (2026-08-20, D2): deploying governance is no longer reachable from the wizard at all — it's
  // an advanced setting on the edit page (DeployGovernanceSection), which calls
  // useDeployGovernance directly rather than through this hook.
  identityCommunityId: string | undefined;
  // True only during setCommunitySetup's registerIdentity()/update() call (community creation
  // wizard fix, 2026-08-21) — the single source of truth for "is a network call in flight right
  // now," read by both StepCommunitySetup (disables its own Back/Next) and CreateCommunityModal
  // (disables the X close button, via CreateCommunityWizard's onSubmittingChange callback). A
  // click on X during this window used to close the modal mid-request with no cleanup.
  isSubmitting: boolean;
}

export interface UseCreateCommunityResult {
  state: WizardState;
  goToStep: (step: WizardStep) => void;
  goBack: () => void;
  setCommunityInfo: (
    name: string,
    description: string,
    parentCommunityId?: string,
    category?: communityApi.CommunityCategory,
  ) => void;
  setCommunitySetup: (config: {
    membershipPolicy: MembershipPolicy;
    tiers: TierDraft[];
    defaultTierLabel: string;
  }) => Promise<void>;
  reset: () => void;
}

const STEP_ORDER: WizardStep[] = ["community_info", "community_setup", "success"];

const INITIAL_STATE: WizardState = {
  step: "community_info",
  config: {},
  identityCommunityId: undefined,
  isSubmitting: false,
};

export function useCreateCommunity(siwe: ReturnType<typeof useSiwe>): UseCreateCommunityResult {
  const [state, setState] = useState<WizardState>(INITIAL_STATE);

  const goToStep = useCallback((step: WizardStep) => {
    setState((prev) => ({ ...prev, step }));
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => {
      const idx = STEP_ORDER.indexOf(prev.step);
      if (idx <= 0) return prev;
      return { ...prev, step: STEP_ORDER[idx - 1] };
    });
  }, []);

  const setCommunityInfo = useCallback(
    (
      displayName: string,
      description: string,
      parentCommunityId?: string,
      category?: communityApi.CommunityCategory,
    ) => {
      setState((prev) => ({
        ...prev,
        config: { ...prev.config, displayName, description, parentCommunityId, category },
        step: "community_setup",
      }));
    },
    [],
  );

  const setCommunitySetup = useCallback(
    async (config: { membershipPolicy: MembershipPolicy; tiers: TierDraft[]; defaultTierLabel: string }) => {
      if (!state.config.displayName) throw new Error("Community name is required");

      setState((prev) => ({ ...prev, isSubmitting: true }));
      try {
        // Architecture 1A/1B: the identity is created here, before any on-chain deployment
        // starts — communityId is a server-generated UUID at this point, not yet a contract
        // address. If the user hit Back and re-submits this step (e.g. changed the membership
        // policy), reuse the already-created identity via update() instead of calling
        // registerIdentity() again, which would silently orphan the first one.
        const identityId = state.identityCommunityId
          ? (
              await withAuthRetry(
                () =>
                  communityApi.update(state.identityCommunityId as string, {
                    membershipPolicy: config.membershipPolicy,
                    category: state.config.category,
                    tierChangesRequireVote: false,
                    defaultTierLabel: config.defaultTierLabel,
                  }),
                siwe.signOut,
              )
            ).id
          : (
              await saveIdentityWithRetry(
                {
                  displayName: state.config.displayName,
                  description: state.config.description,
                  parentCommunityId: state.config.parentCommunityId,
                  category: state.config.category,
                  membershipPolicy: config.membershipPolicy,
                  tierChangesRequireVote: false,
                  tiers: config.tiers,
                  defaultTierLabel: config.defaultTierLabel,
                  source: "wizard",
                },
                siwe.signOut,
              )
            ).id;

        setState((prev) => ({
          ...prev,
          config: {
            ...prev.config,
            membershipPolicy: config.membershipPolicy,
            tierChangesRequireVote: false,
            tiers: config.tiers,
            defaultTierLabel: config.defaultTierLabel,
            stateTreeDepth: STATE_TREE_DEPTH,
          },
          identityCommunityId: identityId,
          // Community creation wizard fix (2026-08-21) — eligibility rules moved out of the
          // wizard entirely (configured later from the community's edit page, which already has
          // a working EligibilityRulesetEditor); this is the wizard's last step now, so success
          // follows directly. Off-chain-only remains a real, intentional end state (2026-08-19
          // community-creation-rework review, D2) — deploying governance stays a separate,
          // explicit opt-in from the edit page, not part of this flow at all anymore.
          step: "success",
          isSubmitting: false,
        }));
      } catch (err) {
        setState((prev) => ({ ...prev, isSubmitting: false }));
        throw err;
      }
    },
    [state.config, state.identityCommunityId, siwe],
  );

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return {
    state,
    goToStep,
    goBack,
    setCommunityInfo,
    setCommunitySetup,
    reset,
  };
}
