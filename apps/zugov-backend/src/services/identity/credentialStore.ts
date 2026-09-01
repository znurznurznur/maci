import { eq, and } from "drizzle-orm";
import { db } from "../../db/client.js";
import { credentials, type Credential } from "../../db/schema.js";
import type { CredentialStatus, Protocol } from "./IdentityProvider.js";

// Storage half of System 3 of 3 identity/eligibility vocabularies (see ENGINEERING.md's
// Decisions Log, 2026-09-01) — verify() itself lives in the sibling IdentityProvider.ts.
// Distinct from EligibilityMechanism (community/tier join, eligibilityService.ts) and
// SignUpPolicyType (poll voter registration, config.ts).
export async function getCredentials(walletAddress: string): Promise<Credential[]> {
  return db.select().from(credentials).where(eq(credentials.walletAddress, walletAddress));
}

export async function getCredential(walletAddress: string, protocol: Protocol): Promise<Credential | null> {
  const rows = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.walletAddress, walletAddress), eq(credentials.protocol, protocol)))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertCredential(
  walletAddress: string,
  protocol: Protocol,
  status: CredentialStatus,
  proofRef: string | undefined,
  now: number,
): Promise<Credential> {
  const inserted = await db
    .insert(credentials)
    .values({
      walletAddress,
      protocol,
      status,
      proofRef: proofRef ?? null,
      lastCheckedAt: now,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [credentials.walletAddress, credentials.protocol],
      set: { status, proofRef: proofRef ?? null, lastCheckedAt: now },
    })
    .returning();
  return inserted[0]!;
}
