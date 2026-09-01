import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCreateCommunity, RESIDENT_ORGANIZER_TIERS } from "./useCreateCommunity";

// Focused on the communities-first wizard flow added by the design review (Pass 1, 2, 7):
// StepMechanism/StepMaciConfig were removed as separate steps; the wizard now goes straight
// from community_info to community_setup, and role selection reuses existing membershipTiers
// instead of a new permission model. Registry/SIWE/wagmi are mocked to no-ops since this test
// only exercises the wizard's own step-transition and config-building logic.
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
  useChainId: () => 11155111,
}));

// useCreateCommunity.ts imports wagmiConfig (src/services/wagmiConfig.ts) for module-level
// signer access (see wagmiSigner.ts) — that module calls real wagmi functions at load time,
// which the plain "wagmi" mock above doesn't provide. Not needed for this test (nothing here
// exercises the actual deploy/signer path), so mock it out entirely rather than trying to make
// createConfig() work under the mock.
vi.mock("@/src/services/wagmiConfig", () => ({
  wagmiConfig: {},
  CHAINS: [],
}));

vi.mock("./useZuGovRegistry", () => ({
  useZuGovRegistry: () => ({
    isLoading: false,
    isSupported: true,
    isReady: true,
    data: undefined,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

// The wizard now requires a shared useSiwe() instance to be passed in (2026-08-19
// community-creation-rework review, D4) rather than calling the hook internally — build one
// mock instance and pass it explicitly at every renderHook() call site below.
function makeMockSiwe() {
  return {
    isAuthenticated: true,
    address: "0x1111111111111111111111111111111111111111",
    isSigning: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    connectionLost: false,
  };
}

vi.mock("@/src/services/checkpointStore", async () => {
  const actual = await vi.importActual<typeof import("@/src/services/checkpointStore")>(
    "@/src/services/checkpointStore",
  );
  return {
    ...actual,
    getPendingCheckpoint: () => null,
    savePendingCheckpoint: vi.fn(),
    clearPendingCheckpoint: vi.fn(),
  };
});

// setCommunitySetup now creates the community's identity via a real network call
// (Architecture 1A/1B) — mock it out so these tests only exercise step-transition logic.
let registerIdentityCounter = 0;
vi.mock("@/src/services/communityApi", async () => {
  const actual = await vi.importActual<typeof import("@/src/services/communityApi")>("@/src/services/communityApi");
  return {
    ...actual,
    registerIdentity: vi.fn(async () => ({ id: `identity-${++registerIdentityCounter}` })),
    update: vi.fn(async (id: string) => ({ id })),
  };
});

beforeEach(async () => {
  localStorage.clear();
  registerIdentityCounter = 0;
  const communityApi = await import("@/src/services/communityApi");
  vi.mocked(communityApi.registerIdentity).mockClear();
  vi.mocked(communityApi.update).mockClear();
});

describe("RESIDENT_ORGANIZER_TIERS", () => {
  it("Resident can vote only; Organizer can vote, create polls, and manage membership", () => {
    const resident = RESIDENT_ORGANIZER_TIERS.find((t) => t.label === "Resident");
    const organizer = RESIDENT_ORGANIZER_TIERS.find((t) => t.label === "Organizer");

    expect(resident).toEqual({
      label: "Resident",
      canVote: true,
      canCreateProposals: false,
      canManageMembership: false,
      canCreateEvents: true,
      requiresCredential: null,
    });
    expect(organizer).toEqual({
      label: "Organizer",
      canVote: true,
      canCreateProposals: true,
      canManageMembership: true,
      canCreateEvents: true,
      requiresCredential: null,
    });
  });
});

describe("useCreateCommunity wizard flow", () => {
  it("starts at community_info, not the removed mechanism step", () => {
    const { result } = renderHook(() => useCreateCommunity(makeMockSiwe()));
    expect(result.current.state.step).toBe("community_info");
  });

  // Community creation wizard fix (2026-08-21): the wizard is 2 real steps now — eligibility
  // rules configuration moved out entirely to the community's edit page, so
  // setCommunitySetup's success lands directly on "success", no intermediate step.
  it("community_info -> community_setup -> success (off-chain-only) with defaults applied", async () => {
    const { result } = renderHook(() => useCreateCommunity(makeMockSiwe()));

    act(() => {
      result.current.setCommunityInfo("Zukas", "Pop-up city residency");
    });
    expect(result.current.state.step).toBe("community_setup");
    expect(result.current.state.config.displayName).toBe("Zukas");

    await act(async () => {
      await result.current.setCommunitySetup({
        membershipPolicy: "open",
        tiers: RESIDENT_ORGANIZER_TIERS,
        defaultTierLabel: "Resident",
      });
    });

    expect(result.current.state.step).toBe("success");
    expect(result.current.state.identityCommunityId).toBeDefined();
    expect(result.current.state.config.membershipPolicy).toBe("open");
    expect(result.current.state.config.tiers).toEqual(RESIDENT_ORGANIZER_TIERS);
    expect(result.current.state.config.defaultTierLabel).toBe("Resident");
  });

  // Creation-time tier editing (D3) — a creator can rename/replace the Resident/Organizer
  // preset instead of being stuck with it; the identity is created with whatever they submit.
  it("submits creator-edited tiers, not the hardcoded preset, when the resident customizes them", async () => {
    const { result } = renderHook(() => useCreateCommunity(makeMockSiwe()));
    const customTiers = [
      {
        label: "Neighbor",
        canVote: true,
        canCreateProposals: false,
        canManageMembership: false,
        canCreateEvents: true,
        requiresCredential: null,
      },
      {
        label: "Steward",
        canVote: true,
        canCreateProposals: true,
        canManageMembership: true,
        canCreateEvents: true,
        requiresCredential: null,
      },
    ];

    act(() => {
      result.current.setCommunityInfo("Zukas", "");
    });
    await act(async () => {
      await result.current.setCommunitySetup({
        membershipPolicy: "open",
        tiers: customTiers,
        defaultTierLabel: "Neighbor",
      });
    });

    expect(result.current.state.config.tiers).toEqual(customTiers);
    expect(result.current.state.config.defaultTierLabel).toBe("Neighbor");
  });

  it("approval-required membership policy is preserved through to success, not silently reset to open", async () => {
    const { result } = renderHook(() => useCreateCommunity(makeMockSiwe()));

    act(() => {
      result.current.setCommunityInfo("Zukas", "");
    });
    await act(async () => {
      await result.current.setCommunitySetup({
        membershipPolicy: "approval",
        tiers: RESIDENT_ORGANIZER_TIERS,
        defaultTierLabel: "Resident",
      });
    });

    expect(result.current.state.config.membershipPolicy).toBe("approval");
  });

  // Community creation wizard fix (2026-08-21) — isSubmitting is now the single source of truth
  // shared between StepCommunitySetup and CreateCommunityModal's X-button gating; this verifies
  // the existing registerIdentity() retry/error path still works unchanged after that lift.
  it("isSubmitting is true only for the duration of setCommunitySetup's identity call, including on failure", async () => {
    const communityApi = await import("@/src/services/communityApi");
    vi.mocked(communityApi.registerIdentity).mockRejectedValueOnce(new communityApi.AuthError());

    const { result } = renderHook(() => useCreateCommunity(makeMockSiwe()));

    act(() => {
      result.current.setCommunityInfo("Zukas", "");
    });
    expect(result.current.state.isSubmitting).toBe(false);

    await act(async () => {
      await expect(
        result.current.setCommunitySetup({
          membershipPolicy: "open",
          tiers: RESIDENT_ORGANIZER_TIERS,
          defaultTierLabel: "Resident",
        }),
      ).rejects.toBeInstanceOf(communityApi.AuthError);
    });

    expect(result.current.state.isSubmitting).toBe(false);
    expect(result.current.state.step).toBe("community_setup");

    await act(async () => {
      await result.current.setCommunitySetup({
        membershipPolicy: "open",
        tiers: RESIDENT_ORGANIZER_TIERS,
        defaultTierLabel: "Resident",
      });
    });

    expect(result.current.state.isSubmitting).toBe(false);
    expect(result.current.state.step).toBe("success");
  });

  it("setCommunitySetup creates the identity once and updates (not re-creates) it on re-submission after Back", async () => {
    const communityApi = await import("@/src/services/communityApi");
    const { result } = renderHook(() => useCreateCommunity(makeMockSiwe()));

    act(() => {
      result.current.setCommunityInfo("Zukas", "");
    });
    await act(async () => {
      await result.current.setCommunitySetup({
        membershipPolicy: "open",
        tiers: RESIDENT_ORGANIZER_TIERS,
        defaultTierLabel: "Resident",
      });
    });
    const firstIdentityId = result.current.state.identityCommunityId;
    expect(firstIdentityId).toBeDefined();
    expect(communityApi.registerIdentity).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.goToStep("community_setup");
    });
    expect(result.current.state.step).toBe("community_setup");

    await act(async () => {
      await result.current.setCommunitySetup({
        membershipPolicy: "approval",
        tiers: RESIDENT_ORGANIZER_TIERS,
        defaultTierLabel: "Resident",
      });
    });

    expect(result.current.state.identityCommunityId).toBe(firstIdentityId);
    expect(communityApi.registerIdentity).toHaveBeenCalledTimes(1);
    expect(communityApi.update).toHaveBeenCalledWith(
      firstIdentityId,
      expect.objectContaining({ membershipPolicy: "approval" }),
    );
  });

  // The direct verification of the originally-reported bug (2026-08-19 community-creation-rework
  // review, D4): a session expiring mid-flow must invalidate the SHARED siwe instance (so
  // SiweGate visibly re-prompts) rather than silently popping a fresh wallet-signature request.
  // withAuthRetry's own fail-fast-on-AuthError behavior is unit-tested in useCreateCommunity.test.ts;
  // this test instead verifies the wiring — that the wizard actually passes signOut from the
  // SAME shared instance callers get, not an internal one of its own.
  it("invalidates the shared siwe session (not a silent retry) when identity creation hits an expired session", async () => {
    const communityApi = await import("@/src/services/communityApi");
    vi.mocked(communityApi.registerIdentity).mockRejectedValueOnce(new communityApi.AuthError());

    const siwe = makeMockSiwe();
    const { result } = renderHook(() => useCreateCommunity(siwe));

    act(() => {
      result.current.setCommunityInfo("Zukas", "");
    });

    await act(async () => {
      await expect(
        result.current.setCommunitySetup({
          membershipPolicy: "open",
          tiers: RESIDENT_ORGANIZER_TIERS,
          defaultTierLabel: "Resident",
        }),
      ).rejects.toBeInstanceOf(communityApi.AuthError);
    });

    expect(siwe.signOut).toHaveBeenCalledTimes(1);
    expect(siwe.signIn).not.toHaveBeenCalled();
    // Still on community_setup — no silent progression past a failed, unauthenticated request.
    expect(result.current.state.step).toBe("community_setup");
  });

  it("goBack from community_setup returns to community_info", () => {
    const { result } = renderHook(() => useCreateCommunity(makeMockSiwe()));

    act(() => {
      result.current.setCommunityInfo("Zukas", "");
    });
    expect(result.current.state.step).toBe("community_setup");

    act(() => {
      result.current.goBack();
    });
    expect(result.current.state.step).toBe("community_info");
  });
});
