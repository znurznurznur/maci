import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StepCommunitySetup } from "./StepCommunitySetup";

// Regression test for a real bug found in eng review: this step is remounted on wizard
// navigation (index.tsx conditionally renders it), so without initial-value props it silently
// reset membershipPolicy to "open" whenever a resident hit Back then forward again — for the
// one screen Tarik/Sait actually depend on.
describe("StepCommunitySetup — restores state across Back navigation", () => {
  it("pre-selects 'approval-required' when initialMembershipPolicy is 'approval'", () => {
    render(
      <StepCommunitySetup
        initialMembershipPolicy="approval"
        isSubmitting={false}
        setCommunitySetup={vi.fn()}
        goBack={vi.fn()}
      />,
    );

    const approvalButton = screen.getByRole("button", { name: /organizers approve new residents/i });
    expect(approvalButton).toHaveAttribute("aria-pressed", "true");
  });

  it("defaults to 'anyone can join' when no initial value is provided (first visit)", () => {
    render(<StepCommunitySetup isSubmitting={false} setCommunitySetup={vi.fn()} goBack={vi.fn()} />);

    const openButton = screen.getByRole("button", { name: /anyone can join/i });
    expect(openButton).toHaveAttribute("aria-pressed", "true");
  });

  // Same class of bug as the membership-policy restore test above, now for the creation-time
  // tier editor (2026-08-19 community-creation-rework review, D3) — a creator's renamed/
  // customized tiers must survive Back-then-forward, not silently reset to the preset.
  it("restores creator-edited tiers when initialTiers is provided", () => {
    render(
      <StepCommunitySetup
        initialTiers={[
          {
            label: "Neighbor",
            canVote: true,
            canCreateProposals: false,
            canManageMembership: false,
            canCreateEvents: true,
            requiresCredential: null,
          },
        ]}
        isSubmitting={false}
        setCommunitySetup={vi.fn()}
        goBack={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue("Neighbor")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Resident")).not.toBeInTheDocument();
  });

  it("defaults to the Resident/Organizer preset when no initialTiers is provided (first visit)", () => {
    render(<StepCommunitySetup isSubmitting={false} setCommunitySetup={vi.fn()} goBack={vi.fn()} />);

    expect(screen.getByDisplayValue("Resident")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Organizer")).toBeInTheDocument();
  });
});

// Community creation wizard fix (2026-08-21): Advanced Settings (mechanism/sign-up-policy/
// voting-mode config) removed from this step entirely — that's now governance deployment,
// reachable only from the community's edit page (Governance Phase 1, D2), not the wizard. The
// "Roles" section is relabeled "Tiers" here (user's exact requested wording).
describe("StepCommunitySetup — Advanced Settings removed", () => {
  it("has no Advanced Settings section", () => {
    render(<StepCommunitySetup isSubmitting={false} setCommunitySetup={vi.fn()} goBack={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /advanced settings/i })).not.toBeInTheDocument();
  });

  it("labels the tier editor section 'Tiers', not 'Roles'", () => {
    render(<StepCommunitySetup isSubmitting={false} setCommunitySetup={vi.fn()} goBack={vi.fn()} />);
    expect(screen.getByText("Tiers")).toBeInTheDocument();
    expect(screen.queryByText("Roles")).not.toBeInTheDocument();
  });
});

// Community creation wizard fix (2026-08-21): isSubmitting is now a required prop, the single
// source of truth shared with CreateCommunityModal's X-button gating — no more local state here.
describe("StepCommunitySetup — isSubmitting prop", () => {
  it("shows 'Create Community' and enables Back/submit when not submitting", () => {
    render(<StepCommunitySetup isSubmitting={false} setCommunitySetup={vi.fn()} goBack={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Create Community" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Back" })).not.toBeDisabled();
  });

  it("shows 'Creating…' and disables Back/submit while submitting", () => {
    render(<StepCommunitySetup isSubmitting={true} setCommunitySetup={vi.fn()} goBack={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });

  it("calls setCommunitySetup with membershipPolicy, tiers, and defaultTierLabel on submit", () => {
    const setCommunitySetup = vi.fn().mockResolvedValue(undefined);
    render(<StepCommunitySetup isSubmitting={false} setCommunitySetup={setCommunitySetup} goBack={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Create Community" }));

    expect(setCommunitySetup).toHaveBeenCalledWith({
      membershipPolicy: "open",
      tiers: expect.arrayContaining([expect.objectContaining({ label: "Resident" })]),
      defaultTierLabel: "Resident",
    });
  });
});
