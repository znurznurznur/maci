import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TierEditor, type EditableTier } from "./TierEditor";

function makeTier(overrides: Partial<EditableTier> = {}): EditableTier {
  return {
    label: "Resident",
    canCreateProposals: false,
    canVote: true,
    canManageMembership: false,
    canCreateEvents: true,
    requiresCredential: null,
    ...overrides,
  };
}

// Credential wedge (2026-08-29 /plan-eng-review, E0) — admin UI for the new requiresCredential
// tier flag. Ships OFF by default (unchecked, no protocol select shown) unlike canCreateEvents.
describe("TierEditor — requiresCredential", () => {
  it("shows the checkbox unchecked and hides the protocol select when requiresCredential is null", () => {
    render(<TierEditor tiers={[makeTier({ requiresCredential: null })]} onChange={vi.fn()} />);

    const checkbox = screen.getByRole("checkbox", { name: /requires a verified credential/i });
    expect(checkbox).not.toBeChecked();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows the checkbox checked and a Zupass/zkID select when requiresCredential is set", () => {
    render(<TierEditor tiers={[makeTier({ requiresCredential: "zupass" })]} onChange={vi.fn()} />);

    const checkbox = screen.getByRole("checkbox", { name: /requires a verified credential/i });
    expect(checkbox).toBeChecked();
    expect(screen.getByRole("combobox")).toHaveValue("zupass");
  });

  it("checking the box sets requiresCredential to zupass, not just true", () => {
    const onChange = vi.fn();
    render(<TierEditor tiers={[makeTier({ requiresCredential: null })]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /requires a verified credential/i }));

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ requiresCredential: "zupass" })]);
  });

  it("unchecking the box resets requiresCredential to null, not undefined or false", () => {
    const onChange = vi.fn();
    render(<TierEditor tiers={[makeTier({ requiresCredential: "zupass" })]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /requires a verified credential/i }));

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ requiresCredential: null })]);
  });

  it("switching the select from Zupass to zkID updates the protocol", () => {
    const onChange = vi.fn();
    render(<TierEditor tiers={[makeTier({ requiresCredential: "zupass" })]} onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zkid" } });

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ requiresCredential: "zkid" })]);
  });

  it("a newly added tier defaults requiresCredential to null (ships OFF)", () => {
    const onChange = vi.fn();
    render(<TierEditor tiers={[makeTier()]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /add tier/i }));

    const newTiers = onChange.mock.calls[0]![0] as EditableTier[];
    expect(newTiers[1]).toEqual(expect.objectContaining({ requiresCredential: null }));
  });

  it("locked disables both the checkbox and the protocol select", () => {
    render(<TierEditor tiers={[makeTier({ requiresCredential: "zupass" })]} onChange={vi.fn()} locked />);

    expect(screen.getByRole("checkbox", { name: /requires a verified credential/i })).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
