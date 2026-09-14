import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { RegistryData } from "./useZuGovRegistry";
import type { Community } from "@/src/services/communityApi";

// Focused on the D7 wallet-switch guard (2026-08-19 community-creation-rework review, outside-voice
// finding): a resident switching wallets mid-deploy must not silently continue under the new
// address — the old checkpoint would be orphaned while an already-deployed contract stays owned
// by the old address. This test drives useDeployGovernance through phase 1, switches the mocked
// connected wallet, then asserts phase 2 never fires and a clear error surfaces instead.

let mockAddress = "0x1111111111111111111111111111111111111111";

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mockAddress }),
  useChainId: () => 11155111,
}));

vi.mock("@/src/services/wagmiConfig", () => ({
  wagmiConfig: {},
  CHAINS: [],
}));

vi.mock("./useZuGovRegistry", () => ({
  useZuGovRegistry: () => ({
    isLoading: false,
    isSupported: true,
    isReady: true,
    data: {
      pollFactory: "0x1111111111111111111111111111111111111111",
      messageProcessorFactory: "0x2222222222222222222222222222222222222222",
      tallyFactory: "0x3333333333333333333333333333333333333333",
      verifier: "0x4444444444444444444444444444444444444444",
      verifyingKeysRegistry: "0x5555555555555555555555555555555555555555",
      poseidonT3: "0x6666666666666666666666666666666666666666",
      poseidonT4: "0x7777777777777777777777777777777777777777",
      poseidonT5: "0x8888888888888888888888888888888888888888",
      poseidonT6: "0x9999999999999999999999999999999999999999",
      coordinatorPubKeyX: 1n,
      coordinatorPubKeyY: 1n,
    } satisfies RegistryData,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/src/services/wagmiSigner", () => ({
  getSignerFromWagmiConfig: vi.fn(async () => ({})),
}));

vi.mock("@/src/services/policyDeploy", () => ({
  deployPolicyContract: vi.fn(async () => "0xPolicyAddress000000000000000000000000000"),
  SET_TARGET_ABI: ["function setTarget(address _guarded)"],
}));

// MACI deployment — a deploy() call whose completion is asserted-against directly (never
// called, in the wallet-switch test) or fully mocked out (in the happy-path test).
const maciDeployMock = vi.fn();
const setTargetMock = vi.fn();
class MockContractFactory {
  deploy(...args: unknown[]) {
    return maciDeployMock(...args);
  }
}
class MockContract {
  setTarget(...args: unknown[]) {
    return setTargetMock(...args);
  }
}
vi.mock("ethers", async () => {
  const actual = await vi.importActual<typeof import("ethers")>("ethers");
  return { ...actual, ContractFactory: MockContractFactory, Contract: MockContract };
});

vi.mock("@znurznurznur/extended-maci-contracts/typechain-types", () => ({
  MACI__factory: { abi: [], bytecode: "0x" },
}));

vi.mock("@znurznurznur/extended-maci-sdk", () => ({
  generateEmptyBallotRoots: () => [0n, 0n, 0n, 0n, 0n],
}));

vi.mock("@znurznurznur/extended-maci-domainobjs", () => ({
  PublicKey: class {
    serialize() {
      return "macipk.test";
    }
  },
}));

vi.mock("@/src/services/communityApi", async () => {
  const actual = await vi.importActual<typeof import("@/src/services/communityApi")>("@/src/services/communityApi");
  return { ...actual, attachGovernance: vi.fn() };
});

function makeMockSiwe() {
  return {
    isAuthenticated: true,
    address: mockAddress,
    isSigning: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    connectionLost: false,
  };
}

const CONFIG = {
  displayName: "Zukas",
  signUpPolicy: { type: "FreeForAll" as const },
  allowedPolicies: [1],
  supportedModes: [1],
};

beforeEach(() => {
  localStorage.clear();
  mockAddress = "0x1111111111111111111111111111111111111111";
  maciDeployMock.mockReset();
});

describe("useDeployGovernance wallet-switch guard (D7)", () => {
  it("stops the deploy and never calls the MACI deploy when the wallet switches mid-flight", async () => {
    // MACI deploy would resolve fine if reached — the assertion is that it's never called.
    maciDeployMock.mockResolvedValue({
      deploymentTransaction: () => ({ wait: async () => ({ status: 1, hash: "0xhash", blockNumber: 1 }) }),
      getAddress: async () => "0xMaciAddress0000000000000000000000000000",
    });

    const { useDeployGovernance } = await import("./useCreateCommunity");
    const { deployPolicyContract } = await import("@/src/services/policyDeploy");
    const { result, rerender } = renderHook(() => useDeployGovernance("community-1", CONFIG, makeMockSiwe()));

    // Simulate the wallet switching while phase 1's on-chain call is in flight (the exact
    // window the outside voice flagged). A deferred promise holds phase 1 open until the test
    // has switched the address AND flushed a real render — addressRef.current only updates via
    // a useEffect reacting to that render, so the switch must be fully committed (not just
    // called mid-microtask) before releasing phase 1 to continue.
    let releasePhase1!: () => void;
    const phase1Gate = new Promise<void>((resolve) => {
      releasePhase1 = resolve;
    });
    vi.mocked(deployPolicyContract).mockImplementationOnce(async () => {
      await phase1Gate;
      return "0xPolicyAddress000000000000000000000000000";
    });

    // Deliberately NOT wrapped in act() here — an outer, unresolved act(async) scope batches
    // and defers any nested state flush (including the rerender() below) until IT resolves,
    // which would make it impossible to observe the wallet switch before phase 1 completes.
    // Calling startDeployment() directly still runs the real promise chain; act() is used below
    // only for the specific synchronous updates that need to flush immediately.
    const deployPromise = result.current.startDeployment();

    await waitFor(() => expect(deployPolicyContract).toHaveBeenCalled());
    mockAddress = "0x2222222222222222222222222222222222222222";
    act(() => {
      rerender();
    });
    releasePhase1();
    await act(async () => {
      await deployPromise;
    });

    expect(maciDeployMock).not.toHaveBeenCalled();
    expect(result.current.state.errorMessage).toMatch(/wallet changed/i);
    expect(result.current.state.completedPhases).toEqual([]);
    expect(result.current.state.isDeployed).toBe(false);
  });

  it("completes normally end to end when the wallet never changes", async () => {
    maciDeployMock.mockResolvedValue({
      deploymentTransaction: () => ({ wait: async () => ({ status: 1, hash: "0xhash", blockNumber: 1 }) }),
      getAddress: async () => "0xMaciAddress0000000000000000000000000000",
    });
    setTargetMock.mockResolvedValue({ wait: async () => ({ status: 1 }) });
    const communityApi = await import("@/src/services/communityApi");
    vi.mocked(communityApi.attachGovernance).mockResolvedValue({ id: "community-1" } as Community);

    const { useDeployGovernance } = await import("./useCreateCommunity");
    const { result } = renderHook(() => useDeployGovernance("community-1", CONFIG, makeMockSiwe()));

    await act(async () => {
      await result.current.startDeployment();
    });

    expect(result.current.state.isDeployed).toBe(true);
    expect(result.current.state.errorMessage).toBeUndefined();
    expect(result.current.state.completedPhases).toEqual([
      "deploy_sign_up_policy",
      "deploy_maci",
      "set_target",
      "save_community",
    ]);
  });
});
