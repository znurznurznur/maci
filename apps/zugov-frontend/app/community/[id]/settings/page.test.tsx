import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Outlet } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CommunitySettingsPage from "./page";
import { HttpError } from "@/src/services/httpClient";
import type { CommunityOutletContext } from "../CommunityLayout";

// community page redesign (/plan-eng-review 2026-08-26, D4) — this page no longer fetches the
// community record or computes isCreator/isCommunityAdmin itself; both now come from
// CommunityLayout's outlet context. Tests render CommunitySettingsPage under a stub parent route
// that supplies a controllable context object, mirroring how CommunityLayout really renders it.
vi.mock("wagmi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi")>();
  return {
    ...actual,
    useConnect: () => ({ connectors: [], connect: vi.fn(), isPending: false, error: null }),
    useDisconnect: () => ({ disconnect: vi.fn() }),
  };
});

const mockSignOut = vi.fn();
vi.mock("@/src/hooks/useSiwe", () => ({
  useSiwe: () => ({ signOut: mockSignOut, isAuthenticated: true, isSigning: false, error: null, signIn: vi.fn() }),
}));

const updateMock = vi.fn();
const listUnionsForCommunityMock = vi.fn();
vi.mock("@/src/services/communityApi", async () => {
  const actual = await vi.importActual<typeof import("@/src/services/communityApi")>("@/src/services/communityApi");
  return {
    ...actual,
    update: (...args: unknown[]) => updateMock(...args),
    listUnionsForCommunity: (...args: unknown[]) => listUnionsForCommunityMock(...args),
  };
});

const getTiersMock = vi.fn();
vi.mock("@/src/services/membershipApi", () => ({
  getTiers: (...args: unknown[]) => getTiersMock(...args),
  createTier: vi.fn(),
  updateTier: vi.fn(),
  deleteTier: vi.fn(),
}));

const getRulesetMock = vi.fn();
const replaceRulesetMock = vi.fn();
vi.mock("@/src/services/eligibilityApi", () => ({
  getRuleset: (...args: unknown[]) => getRulesetMock(...args),
  replaceRuleset: (...args: unknown[]) => replaceRulesetMock(...args),
}));

const listDecisionAdaptersMock = vi.fn();
vi.mock("@/src/services/zupollApi", () => ({
  listDecisionAdapters: (...args: unknown[]) => listDecisionAdaptersMock(...args),
}));

const CREATOR_ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";

const COMMUNITY = {
  id: "community-1",
  displayName: "Zukas Residency",
  description: "",
  logo: "",
  creatorAddress: CREATOR_ADDRESS,
  parentCommunityId: null,
  membershipPolicy: "open" as const,
  category: null,
  allowJoin: true,
  tierChangesRequireVote: false,
  directDeploymentEnabled: false,
  defaultTierId: null,
  cosponsorshipThreshold: 0,
  createdAt: 0,
  registeredAt: 0,
  // Required by the Community type; the page's DeployGovernanceSection gate now reads
  // attachedAdapters (mocked via listDecisionAdaptersMock below), not this field directly.
  governanceConfigured: true,
  contractAddress: null,
  chainId: null,
  governanceType: null,
  allowedPolicies: [] as number[],
  supportedModes: [] as number[],
  signUpPolicyType: null,
  signUpPolicyAddress: null,
  stateTreeDepth: null,
  subgraphStatus: null,
  subgraphName: null,
};

function baseContext(overrides: Partial<CommunityOutletContext> = {}): CommunityOutletContext {
  return {
    community: COMMUNITY as CommunityOutletContext["community"],
    address: CREATOR_ADDRESS,
    connected: true,
    status: "connected",
    isCreator: true,
    isCommunityAdmin: false,
    rpcUrl: "http://mock-rpc",
    ...overrides,
  };
}

function ParentWithContext({ context }: { context: CommunityOutletContext }) {
  return <Outlet context={context} />;
}

function renderPage(context: CommunityOutletContext = baseContext()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/community/community-1/settings"]}>
        <Routes>
          <Route path="/community/:id" element={<ParentWithContext context={context} />}>
            <Route path="settings" element={<CommunitySettingsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

beforeEach(() => {
  mockSignOut.mockReset();
  updateMock.mockReset();
  getTiersMock.mockReset();
  getRulesetMock.mockReset();
  replaceRulesetMock.mockReset();
  listDecisionAdaptersMock.mockReset();
  listUnionsForCommunityMock.mockReset();

  getTiersMock.mockResolvedValue([]);
  getRulesetMock.mockResolvedValue([]);
  replaceRulesetMock.mockResolvedValue(undefined);
  listUnionsForCommunityMock.mockResolvedValue([]);
  listDecisionAdaptersMock.mockResolvedValue({ adapters: ["maci"] });
});

// CRITICAL regression (community page redesign, /plan-eng-review 2026-08-26) — isCreator/
// isCommunityAdmin used to be computed here via a hand-rolled duplicate of useIsCommunityAdmin;
// now they arrive via outlet context from CommunityLayout. These tests prove the gate still
// reads them correctly at the new boundary. The canManageMembership-tier resolution itself is
// now unit-tested directly on the hook in useMembershipPermission.test.tsx (D7) — it doesn't need
// re-proving here.
describe("CommunitySettingsPage authorization gate", () => {
  it("shows the settings form to the community's creator", async () => {
    renderPage(baseContext({ isCreator: true, isCommunityAdmin: false }));

    expect(await screen.findByText("Community Settings")).toBeInTheDocument();
    expect(screen.getByText("Save Changes")).toBeInTheDocument();
  });

  it("blocks a non-creator, non-admin wallet with a clear message, not the form", async () => {
    renderPage(baseContext({ address: OTHER_ADDRESS, isCreator: false, isCommunityAdmin: false }));

    expect(await screen.findByText(/Only this community.s creator or an admin can manage it/)).toBeInTheDocument();
    expect(screen.queryByText("Community Settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Save Changes")).not.toBeInTheDocument();
  });

  it("grants access to a non-creator wallet flagged as a community admin", async () => {
    renderPage(baseContext({ address: OTHER_ADDRESS, isCreator: false, isCommunityAdmin: true }));

    expect(await screen.findByText("Community Settings")).toBeInTheDocument();
    expect(screen.getByText("Save Changes")).toBeInTheDocument();
  });
});

// The community record itself is now guaranteed non-null by the time this page mounts
// (CommunityLayout's own loading/not-found gate, covered by CommunityLayout.test.tsx) — this
// page only has its own settings-specific loading state left (tiers/rules/decisionAdapters).
describe("CommunitySettingsPage settings-data load state", () => {
  it("shows a loading state before tiers/rules/decisionAdapters resolve", () => {
    getTiersMock.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByText("Loading settings…")).toBeInTheDocument();
  });
});

describe("CommunitySettingsPage tier removal cascade", () => {
  const TIER_REGULAR = {
    id: "tier-regular",
    label: "Regular",
    canCreateProposals: false,
    canVote: true,
    canManageMembership: false,
    canCreateEvents: true,
    requiresCredential: null,
    isDefault: true,
  };
  const TIER_VIP = {
    id: "tier-vip",
    label: "VIP",
    canCreateProposals: true,
    canVote: true,
    canManageMembership: false,
    canCreateEvents: true,
    requiresCredential: null,
    isDefault: false,
  };

  it("resets the default tier selection when the removed tier was the default", async () => {
    getTiersMock.mockResolvedValue([TIER_REGULAR, TIER_VIP]);
    renderPage(
      baseContext({
        community: { ...COMMUNITY, defaultTierId: "tier-regular" } as CommunityOutletContext["community"],
      }),
    );

    await screen.findByText("Community Settings");
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("Regular");

    // Remove the "Regular" tier (the current default) — its Remove button is the first one.
    fireEvent.click(screen.getAllByText("Remove")[0]!);

    await waitFor(() => expect(select.value).toBe("VIP"));
  });

  it("drops an eligibility rule that referenced the removed tier", async () => {
    getTiersMock.mockResolvedValue([TIER_REGULAR, TIER_VIP]);
    getRulesetMock.mockResolvedValue([
      { id: "rule-1", groupIndex: 0, mechanism: "tier", targetTierId: undefined, config: { tierId: "tier-regular" } },
    ]);
    renderPage(
      baseContext({ community: { ...COMMUNITY, defaultTierId: "tier-vip" } as CommunityOutletContext["community"] }),
    );

    await screen.findByText("Community Settings");
    fireEvent.click(screen.getAllByText("Remove")[0]!);
    fireEvent.click(screen.getByText("Save Changes"));

    await waitFor(() => expect(replaceRulesetMock).toHaveBeenCalledWith("community-1", []));
  });
});

describe("CommunitySettingsPage save flow", () => {
  it("saves successfully and navigates away", async () => {
    updateMock.mockResolvedValue(undefined);
    renderPage();

    await screen.findByText("Community Settings");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
  });

  // Bug fix (2026-08-28) — CommunityLayout.tsx caches the community under
  // queryKey ["community", communityId]; without invalidating it here, navigating back after a
  // save previously kept rendering the stale pre-save object until a full page reload.
  it("invalidates the cached community query after a successful save", async () => {
    updateMock.mockResolvedValue(undefined);
    const { queryClient } = renderPage();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await screen.findByText("Community Settings");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["community", "community-1"] }));
  });

  it("includes allowJoin in the save payload", async () => {
    updateMock.mockResolvedValue(undefined);
    renderPage(baseContext({ community: { ...COMMUNITY, allowJoin: false } as CommunityOutletContext["community"] }));

    await screen.findByText("Community Settings");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith("community-1", expect.objectContaining({ allowJoin: false })),
    );
  });

  it("shows an error and signs out when saving fails with an expired session (401)", async () => {
    updateMock.mockRejectedValue(new HttpError(401, "Authentication required. Please sign in with Ethereum."));
    renderPage();

    await screen.findByText("Community Settings");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(screen.getByText("Authentication required. Please sign in with Ethereum.")).toBeInTheDocument(),
    );
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("shows an error without signing out when saving fails with a non-auth error", async () => {
    updateMock.mockRejectedValue(new Error("Network error"));
    renderPage();

    await screen.findByText("Community Settings");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(screen.getByText("Network error")).toBeInTheDocument());
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
