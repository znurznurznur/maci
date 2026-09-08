export type CredentialStatus = "verified" | "unverified" | "expired";
export type Protocol = "zupass" | "zkid";

// System 3 of 3 identity/eligibility vocabularies (see ENGINEERING.md's Decisions Log,
// 2026-09-01) — VERIFIES a real-world credential (Zupass/zkID) against a wallet; storage lives
// in the sibling credentialStore.ts. Distinct from EligibilityMechanism (community/tier join,
// eligibilityService.ts) and SignUpPolicyType (poll voter registration, config.ts).
export interface IdentityProvider {
  readonly protocol: Protocol;
  readonly trustModel: "zk-verified-offchain";
  readonly walletOrigin: "attaches-to-existing-wallet";

  /**
   * Verifies a protocol-specific proof payload against the given wallet address, against
   * either this adapter's baseline predicate (default, used by this feature) or a
   * caller-supplied predicate (used by the later, out-of-scope community eligibility-logic
   * capability). Zupass has no predicate concept and ignores this parameter.
   * Throws on a malformed payload; returns "expired" only when `previousStatus` was
   * "verified" and this check now fails.
   */
  verify(input: {
    walletAddress: string;
    proofPayload: unknown;
    previousStatus: CredentialStatus;
    predicate?: unknown;
  }): Promise<{ status: CredentialStatus; proofRef?: string }>;
}
