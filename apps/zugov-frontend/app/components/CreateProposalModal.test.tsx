import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PollDeployConfig } from "@/src/config";
import { CreateProposalModal } from "./CreateProposalModal";

const getTiersMock = vi.fn();
const listMembersMock = vi.fn();
const getMembershipStatusMock = vi.fn();
vi.mock("@/src/services/membershipApi", () => ({
  getTiers: (...args: unknown[]) => getTiersMock(...args),
  listMembers: (...args: unknown[]) => listMembersMock(...args),
  getMembershipStatus: (...args: unknown[]) => getMembershipStatusMock(...args),
}));

const listCredentialsMock = vi.fn();
vi.mock("@/src/services/credentialApi", () => ({
  list: (...args: unknown[]) => listCredentialsMock(...args),
}));

const createDraftMock = vi.fn();
const authorizeDirectMock = vi.fn();
const confirmDirectMock = vi.fn();
vi.mock("@/src/services/proposalApi", () => ({
  createDraft: (...args: unknown[]) => createDraftMock(...args),
  authorizeDirect: (...args: unknown[]) => authorizeDirectMock(...args),
  confirmDirect: (...args: unknown[]) => confirmDirectMock(...args),
}));

vi.mock("wagmi", () => ({
  useChainId: () => 11155111,
}));

// /plan-eng-review (2026-08-23) Batch 3 -- this component now calls useSiwe() for
// withAuthDetect. Mocking the module directly (matching JoinSection.test.tsx's convention), not
// wrapping in a real SiweProvider -- no test here exercises SiweProvider's own state machine.
const mockSignOut = vi.fn();
vi.mock("@/src/hooks/useSiwe", () => ({
  useSiwe: () => ({ signOut: mockSignOut }),
}));

const deployPollMock = vi.fn();
const getEthersSignerMock = vi.fn(() => Promise.resolve({}));
vi.mock("@/src/hooks/useDeployPoll", () => ({
  useDeployPoll: () => ({
    isDeploying: false,
    deployStep: null,
    deployError: null,
    deployPoll: (...args: unknown[]) => deployPollMock(...args),
  }),
  getEthersSigner: () => getEthersSignerMock(),
}));

const deployPolicyContractMock = vi.fn((..._args: unknown[]) => Promise.resolve("0xPolicy"));
vi.mock("@/src/services/policyDeploy", () => ({
  deployPolicyContract: (...args: unknown[]) => deployPolicyContractMock(...args),
  SET_TARGET_ABI: ["function setTarget(address _guarded)"],
}));

const POLL_DEPLOY_CONFIG: PollDeployConfig = {
  coordinatorPublicKey: "macipk.842ada068e4156f836e02336160ae0172f0dd9b43280edeb4572c57793068dd3",
  treeDepths: { tallyProcessingStateTreeDepth: 1, voteOptionTreeDepth: 2, stateTreeDepth: 6 },
  messageBatchSize: 20,
  freeForAllPolicyFactory: "0x4dF289F131b388bC805995adBB1006471e2cEedD",
  freeForAllChecker: "0xa87fCEB0064f064b6a5Fa54AF85014a24ce99162",
  constantVoiceCreditProxyFactory: "0xF49949D519f0A321bb08b0ca94dEF40E98b663eF",
  initialVoiceCreditAmount: 100,
};

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillCommonFields() {
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Fund the garden" } });
  fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Details here" } });
}

beforeEach(() => {
  getTiersMock.mockReset();
  listMembersMock.mockReset();
  getMembershipStatusMock.mockReset();
  listCredentialsMock.mockReset();
  createDraftMock.mockReset();
  authorizeDirectMock.mockReset();
  confirmDirectMock.mockReset();
  deployPollMock.mockReset();
  mockSignOut.mockReset();
  getTiersMock.mockResolvedValue([
    { id: "tier-voter", label: "Voter", canVote: true, isDefault: false, requiresCredential: null },
    { id: "tier-guest", label: "Guest", canVote: false, isDefault: true, requiresCredential: null },
  ]);
  listMembersMock.mockResolvedValue([
    { walletAddress: "0x1111111111111111111111111111111111111a", tierLabel: "Voter" },
    { walletAddress: "0x2222222222222222222222222222222222222b", tierLabel: "Voter" },
  ]);
  getMembershipStatusMock.mockResolvedValue({ status: "member", tierLabel: "Voter" });
  listCredentialsMock.mockResolvedValue([]);
});

describe("CreateProposalModal", () => {
  it("renders non-executable axis options as visible but disabled", async () => {
    renderWithProviders(<CreateProposalModal isOpen={true} onClose={() => {}} communityId="0xabc" />);

    await waitFor(() => expect(screen.getByText(/Every voting-capable tier/)).toBeInTheDocument());

    const publicRadio = screen.getByText("Public").closest("div")!.parentElement!.querySelector("input")!;
    expect(publicRadio).toBeDisabled();

    const offchainRadio = screen.getByText("Offchain").closest("div")!.parentElement!.querySelector("input")!;
    expect(offchainRadio).toBeDisabled();
    const hybridRadio = screen.getByText("Hybrid").closest("div")!.parentElement!.querySelector("input")!;
    expect(hybridRadio).toBeDisabled();

    const weightedOption = screen.getByRole("option", { name: /Weighted/ }) as HTMLOptionElement;
    expect(weightedOption.disabled).toBe(true);

    // only voting-capable tiers are mentioned as eligible
    expect(screen.queryByText("Guest")).not.toBeInTheDocument();
  });

  it("auto-derives eligibleTierIds from every voting-capable tier, without a manual picker (specs/010 US7, FR-014)", async () => {
    createDraftMock.mockResolvedValue({ proposal: {} });
    renderWithProviders(<CreateProposalModal isOpen={true} onClose={() => {}} communityId="0xabc" />);

    await waitFor(() => expect(screen.getByText("Voter", { exact: false })).toBeInTheDocument());
    // No checkbox/tier picker exists — only voting-tier data appears as read-only explanatory text.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    await fillCommonFields();
    fireEvent.click(screen.getByText("Create Draft"));

    await waitFor(() => expect(createDraftMock).toHaveBeenCalled());
    expect(createDraftMock).toHaveBeenCalledWith("0xabc", expect.objectContaining({ eligibleTierIds: ["tier-voter"] }));
  });

  it("surfaces a 403 rejection instead of silently succeeding", async () => {
    createDraftMock.mockRejectedValue(new Error("Not authorized to create governance actions"));
    renderWithProviders(<CreateProposalModal isOpen={true} onClose={() => {}} communityId="0xabc" />);

    await waitFor(() => expect(screen.getByText(/Every voting-capable tier/)).toBeInTheDocument());

    await fillCommonFields();
    fireEvent.click(screen.getByText("Create Draft"));

    await waitFor(() => expect(screen.getByText("Not authorized to create governance actions")).toBeInTheDocument());
  });

  // /plan-eng-review (2026-08-23) Batch 3
  it("signs the wallet out when creating a draft fails with an expired session (401)", async () => {
    const { HttpError } = await import("@/src/services/httpClient");
    createDraftMock.mockRejectedValue(new HttpError(401, "Authentication required. Please sign in with Ethereum."));
    renderWithProviders(<CreateProposalModal isOpen={true} onClose={() => {}} communityId="0xabc" />);

    await waitFor(() => expect(screen.getByText(/Every voting-capable tier/)).toBeInTheDocument());

    await fillCommonFields();
    fireEvent.click(screen.getByText("Create Draft"));

    await waitFor(() =>
      expect(screen.getByText("Authentication required. Please sign in with Ethereum.")).toBeInTheDocument(),
    );
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  describe("direct deployment mode (specs/007 US2)", () => {
    // No community prop is passed in these tests, so allowedPolicyTypes is empty and the
    // eligibility policy picker falls back to "FreeForAll", which needs no extra parameter
    // fields, matching this mode's replacement of the old tier checkboxes.
    async function fillDirectModeFields() {
      fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Fund the garden" } });
      fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Details here" } });
      fireEvent.change(screen.getByLabelText(/Start Date/), { target: { value: "2026-01-01T00:00" } });
      fireEvent.change(screen.getByLabelText(/End Date/), { target: { value: "2026-01-02T00:00" } });
      const optionInputs = screen.getAllByPlaceholderText(/Option \d/);
      fireEvent.change(optionInputs[0]!, { target: { value: "Yes" } });
      fireEvent.change(optionInputs[1]!, { target: { value: "No" } });
    }

    it("renders deploy-time fields and calls authorizeDirect → deployPoll → confirmDirect in order", async () => {
      authorizeDirectMock.mockResolvedValue({ authorized: true });
      deployPollMock.mockResolvedValue({ pollAddress: "0xPoll", pollId: "0", txHash: "0xTx" });
      confirmDirectMock.mockResolvedValue({ proposal: {} });

      renderWithProviders(
        <CreateProposalModal
          isOpen={true}
          onClose={() => {}}
          communityId="0xabc"
          directDeploymentEnabled={true}
          pollDeployConfig={POLL_DEPLOY_CONFIG}
        />,
      );

      await waitFor(() => expect(screen.getByLabelText(/Title/)).toBeInTheDocument());
      await fillDirectModeFields();
      fireEvent.click(screen.getByText("Deploy Poll"));

      await waitFor(() => expect(confirmDirectMock).toHaveBeenCalled());
      expect(authorizeDirectMock).toHaveBeenCalled();
      expect(deployPollMock).toHaveBeenCalled();

      const authorizeOrder = authorizeDirectMock.mock.invocationCallOrder[0]!;
      const deployOrder = deployPollMock.mock.invocationCallOrder[0]!;
      const confirmOrder = confirmDirectMock.mock.invocationCallOrder[0]!;
      expect(authorizeOrder).toBeLessThan(deployOrder);
      expect(deployOrder).toBeLessThan(confirmOrder);
    });

    it("surfaces an authorizeDirect 403 and never calls deployPoll", async () => {
      authorizeDirectMock.mockRejectedValue(new Error("Not authorized to create governance actions"));

      renderWithProviders(
        <CreateProposalModal
          isOpen={true}
          onClose={() => {}}
          communityId="0xabc"
          directDeploymentEnabled={true}
          pollDeployConfig={POLL_DEPLOY_CONFIG}
        />,
      );

      await waitFor(() => expect(screen.getByLabelText(/Title/)).toBeInTheDocument());
      await fillDirectModeFields();
      fireEvent.click(screen.getByText("Deploy Poll"));

      await waitFor(() => expect(screen.getByText("Not authorized to create governance actions")).toBeInTheDocument());
      expect(deployPollMock).not.toHaveBeenCalled();
    });

    // /plan-eng-review (2026-08-23) Batch 3
    it("signs the wallet out when authorizeDirect fails with an expired session (401)", async () => {
      const { HttpError } = await import("@/src/services/httpClient");
      authorizeDirectMock.mockRejectedValue(
        new HttpError(401, "Authentication required. Please sign in with Ethereum."),
      );

      renderWithProviders(
        <CreateProposalModal
          isOpen={true}
          onClose={() => {}}
          communityId="0xabc"
          directDeploymentEnabled={true}
          pollDeployConfig={POLL_DEPLOY_CONFIG}
        />,
      );

      await waitFor(() => expect(screen.getByLabelText(/Title/)).toBeInTheDocument());
      await fillDirectModeFields();
      fireEvent.click(screen.getByText("Deploy Poll"));

      await waitFor(() =>
        expect(screen.getByText("Authentication required. Please sign in with Ethereum.")).toBeInTheDocument(),
      );
      expect(deployPollMock).not.toHaveBeenCalled();
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });

    // Governance restructure Phase 2 (2026-08-20) — person-type (election) proposals, direct-
    // deploy path only.
    describe("person-type (election) options", () => {
      const MEMBER_A = "0x1111111111111111111111111111111111111a";
      const MEMBER_B = "0x2222222222222222222222222222222222222b";

      async function selectPersonType() {
        fireEvent.change(screen.getByLabelText(/Decision Type/), { target: { value: "person" } });
        await waitFor(() => expect(listMembersMock).toHaveBeenCalled());
      }

      it("shows a member picker per candidate once Person is selected", async () => {
        renderWithProviders(
          <CreateProposalModal
            isOpen={true}
            onClose={() => {}}
            communityId="0xabc"
            directDeploymentEnabled={true}
            pollDeployConfig={POLL_DEPLOY_CONFIG}
          />,
        );
        await waitFor(() => expect(screen.getByLabelText(/Title/)).toBeInTheDocument());

        expect(screen.queryAllByDisplayValue("Pick a member…")).toHaveLength(0);
        await selectPersonType();
        await waitFor(() => expect(screen.getAllByDisplayValue("Pick a member…")).toHaveLength(2));
        expect(screen.getByText(/Candidates \* \(at least 2\)/)).toBeInTheDocument();
      });

      it("blocks submission until every candidate has a picked, distinct member", async () => {
        renderWithProviders(
          <CreateProposalModal
            isOpen={true}
            onClose={() => {}}
            communityId="0xabc"
            directDeploymentEnabled={true}
            pollDeployConfig={POLL_DEPLOY_CONFIG}
          />,
        );
        await waitFor(() => expect(screen.getByLabelText(/Title/)).toBeInTheDocument());
        await fillDirectModeFields();
        await selectPersonType();
        const memberPickers = await waitFor(() => screen.getAllByDisplayValue("Pick a member…"));

        // No member picked yet — still blocked.
        expect(screen.getByText("Deploy Poll")).toBeDisabled();

        // Both candidates pick the SAME member — still blocked (must be distinct).
        fireEvent.change(memberPickers[0]!, { target: { value: MEMBER_A } });
        fireEvent.change(memberPickers[1]!, { target: { value: MEMBER_A } });
        expect(screen.getByText("Deploy Poll")).toBeDisabled();

        // Distinct members picked — now ready.
        fireEvent.change(memberPickers[1]!, { target: { value: MEMBER_B } });
        expect(screen.getByText("Deploy Poll")).not.toBeDisabled();
      });

      it("keeps options and optionMemberAddresses index-aligned when a middle candidate is left blank", async () => {
        authorizeDirectMock.mockResolvedValue({ authorized: true });
        deployPollMock.mockResolvedValue({ pollAddress: "0xPoll", pollId: "0", txHash: "0xTx" });
        confirmDirectMock.mockResolvedValue({ proposal: {} });

        renderWithProviders(
          <CreateProposalModal
            isOpen={true}
            onClose={() => {}}
            communityId="0xabc"
            directDeploymentEnabled={true}
            pollDeployConfig={POLL_DEPLOY_CONFIG}
          />,
        );
        await waitFor(() => expect(screen.getByLabelText(/Title/)).toBeInTheDocument());
        await fillDirectModeFields();
        await selectPersonType();

        // Add a third candidate slot, then leave the MIDDLE one (index 1) blank — the bug this
        // regression test guards against would pair MEMBER_B with the blank slot instead of
        // Candidate C, or shift indices once the blank is dropped.
        fireEvent.click(screen.getByText("+ Add Candidate"));
        const candidateInputs = screen.getAllByPlaceholderText(/Candidate label \d/);
        fireEvent.change(candidateInputs[0]!, { target: { value: "Alice" } });
        fireEvent.change(candidateInputs[1]!, { target: { value: "" } });
        fireEvent.change(candidateInputs[2]!, { target: { value: "Charlie" } });

        const memberPickers = screen.getAllByDisplayValue("Pick a member…");
        fireEvent.change(memberPickers[0]!, { target: { value: MEMBER_A } });
        // memberPickers[1] (paired with the blank candidate) deliberately left unpicked.
        fireEvent.change(memberPickers[2]!, { target: { value: MEMBER_B } });

        fireEvent.click(screen.getByText("Deploy Poll"));

        await waitFor(() => expect(confirmDirectMock).toHaveBeenCalled());
        const confirmPayload = confirmDirectMock.mock.calls[0]![1] as {
          options: string[];
          optionMemberAddresses: string[];
        };
        expect(confirmPayload.options).toEqual(["Alice", "Charlie"]);
        expect(confirmPayload.optionMemberAddresses).toEqual([MEMBER_A, MEMBER_B]);
      });
    });

    it("renders the pollDeployConfig-missing fallback and never calls authorizeDirect", async () => {
      renderWithProviders(
        <CreateProposalModal
          isOpen={true}
          onClose={() => {}}
          communityId="0xabc"
          directDeploymentEnabled={true}
          pollDeployConfig={null}
        />,
      );

      expect(screen.getByText(/on-chain deployment isn't linked/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/Title/)).not.toBeInTheDocument();
      expect(authorizeDirectMock).not.toHaveBeenCalled();
    });
  });

  // Credential wedge (2026-08-29 /plan-eng-review, E0) — this is a display-only approximation of
  // the backend's hasRequiredCredential check (the real security boundary); these tests cover the
  // UI's three states, not the server-side gate (see proposals.test.ts/zupoll.test.ts for that).
  describe("credential-blocked state (E0)", () => {
    it("shows no warning and an enabled submit button when the tier has no requiresCredential", async () => {
      renderWithProviders(<CreateProposalModal isOpen={true} onClose={() => {}} communityId="0xabc" />);

      await waitFor(() => expect(screen.getByText(/Every voting-capable tier/)).toBeInTheDocument());

      expect(screen.queryByText(/requires a verified/i)).not.toBeInTheDocument();
      await fillCommonFields();
      expect(screen.getByText("Create Draft")).not.toBeDisabled();
    });

    it("shows the blocked warning + verify link and disables submit when the tier requires a credential the caller lacks", async () => {
      getTiersMock.mockResolvedValue([
        { id: "tier-voter", label: "Voter", canVote: true, isDefault: false, requiresCredential: "zupass" },
      ]);
      getMembershipStatusMock.mockResolvedValue({ status: "member", tierLabel: "Voter" });
      listCredentialsMock.mockResolvedValue([]);

      renderWithProviders(<CreateProposalModal isOpen={true} onClose={() => {}} communityId="0xabc" />);

      await waitFor(() => expect(screen.getByText(/requires a verified Zupass/i)).toBeInTheDocument());
      expect(screen.getByRole("link", { name: /verify your credential/i })).toHaveAttribute("href", "/manage-profile");

      await fillCommonFields();
      expect(screen.getByText("Create Draft")).toBeDisabled();
    });

    it("clears the block and enables submit once the caller has a verified credential for the required protocol", async () => {
      getTiersMock.mockResolvedValue([
        { id: "tier-voter", label: "Voter", canVote: true, isDefault: false, requiresCredential: "zupass" },
      ]);
      getMembershipStatusMock.mockResolvedValue({ status: "member", tierLabel: "Voter" });
      listCredentialsMock.mockResolvedValue([{ protocol: "zupass", status: "verified" }]);

      renderWithProviders(<CreateProposalModal isOpen={true} onClose={() => {}} communityId="0xabc" />);

      await waitFor(() => expect(screen.getByText(/Every voting-capable tier/)).toBeInTheDocument());
      expect(screen.queryByText(/requires a verified/i)).not.toBeInTheDocument();

      await fillCommonFields();
      expect(screen.getByText("Create Draft")).not.toBeDisabled();
    });

    it("still blocks when a credential row exists for the protocol but isn't verified (unverified/expired)", async () => {
      getTiersMock.mockResolvedValue([
        { id: "tier-voter", label: "Voter", canVote: true, isDefault: false, requiresCredential: "zupass" },
      ]);
      getMembershipStatusMock.mockResolvedValue({ status: "member", tierLabel: "Voter" });
      listCredentialsMock.mockResolvedValue([{ protocol: "zupass", status: "expired" }]);

      renderWithProviders(<CreateProposalModal isOpen={true} onClose={() => {}} communityId="0xabc" />);

      await waitFor(() => expect(screen.getByText(/requires a verified Zupass/i)).toBeInTheDocument());
      await fillCommonFields();
      expect(screen.getByText("Create Draft")).toBeDisabled();
    });
  });
});
