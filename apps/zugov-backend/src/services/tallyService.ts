import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { maciGovernanceConfigs, proposals, type Proposal } from "../db/schema.js";
import { runTallyPipeline } from "./coordinatorClient.js";
import { isAuthorized } from "./membershipService.js";
import { ProposalNotFoundError } from "./proposalService.js";

export class NotAuthorizedToTallyError extends Error {
  constructor() {
    super("Not authorized to trigger tallying for this community");
  }
}

export class PollNotDeployedError extends Error {
  constructor() {
    super("This governance action has no deployed poll to tally");
  }
}

export class PollNotClosedError extends Error {
  constructor() {
    super("This poll hasn't closed yet");
  }
}

export class TallyAlreadyInProgressError extends Error {
  constructor() {
    super("Tallying is already in progress or has already completed for this poll");
  }
}

export class UnsupportedChainForTallyError extends Error {
  constructor() {
    // Same single-network limitation documented in coordinatorClient.ts/deploy/docker-compose.yml.
    super("Tallying is currently only supported for Sepolia communities");
  }
}

// DomainObjs.Mode values (see apps/zugov-frontend/src/hooks/useDeployPoll.ts's EMode and
// ProposalsList.tsx's VOTING_PROTOCOL_TYPE_TO_MODE — kept in sync manually, no shared package
// between frontend/backend for this small an enum).
const VOTING_PROTOCOL_TYPE_TO_MODE: Record<Proposal["votingProtocolType"], number> = {
  quadratic: 0,
  simple: 1,
  full: 2,
  ranked: 3,
  weighted: 1,
};

const SEPOLIA_CHAIN_ID = 11155111;

// Governance restructure Phase 2 (2026-08-20) — "person"-type (election) proposals only. Not a
// full @extended-maci/sdk dependency (zugov-backend doesn't otherwise depend on it) — a minimal
// duck-typed shape matching the coordinator's real ITallyData.results.tally: string[] response
// (packages/sdk/ts/tally/types.ts, confirmed against apps/coordinator/ts/proof/proof.controller.ts's
// `submit(): Promise<ITallyData>`), same index order as `options`/`optionMemberAddresses`.
interface CoordinatorTallyResult {
  results?: { tally: string[] };
}

/** No winner on a tie (including an all-zero, nobody-voted tally, which ties every option at 0)
 * — an honest "no winner" state, never a guessed one. Exported for direct unit testing —
 * runTallyInBackground itself requires a real coordinator + MACI contract to exercise
 * end-to-end, which no existing test in this file sets up. */
export function resolveElectionWinner(tallyData: unknown, optionMemberAddresses: string[]): string | null {
  const tally = (tallyData as CoordinatorTallyResult | undefined)?.results?.tally;
  if (!Array.isArray(tally) || tally.length !== optionMemberAddresses.length) return null;

  const counts = tally.map((value) => BigInt(value));
  const maxCount = counts.reduce((max, count) => (count > max ? count : max), counts[0] ?? 0n);
  const winningIndices = counts.flatMap((count, index) => (count === maxCount ? [index] : []));

  if (winningIndices.length !== 1) return null;
  return optionMemberAddresses[winningIndices[0]!] ?? null;
}

async function getActionOrThrow(communityId: string, actionId: string): Promise<Proposal> {
  const [row] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, actionId), eq(proposals.communityId, communityId)))
    .limit(1);
  if (!row) throw new ProposalNotFoundError();
  return row;
}

export async function getTallyStatus(
  communityId: string,
  actionId: string,
): Promise<
  Pick<
    Proposal,
    "tallyStatus" | "tallyError" | "tallyRequestedAt" | "tallyCompletedAt" | "tallyResult" | "electedWalletAddress"
  >
> {
  const action = await getActionOrThrow(communityId, actionId);
  return {
    tallyStatus: action.tallyStatus,
    tallyError: action.tallyError,
    tallyRequestedAt: action.tallyRequestedAt,
    tallyCompletedAt: action.tallyCompletedAt,
    tallyResult: action.tallyResult,
    // "Person"-type only (governance restructure Phase 2) — surfaced here, not just on the base
    // proposal read, because this is the query the frontend actually polls while a tally is in
    // progress (ProposalsList.tsx's TallySection); the outer proposal-list query is fetched once
    // and never invalidated when a background tally completes.
    electedWalletAddress: action.electedWalletAddress,
  };
}

/** Validates the request and flips the row to "pending", then runs the actual coordinator
 * pipeline as a background task (fire-and-forget) — merge/generate/submit together can take
 * anywhere from minutes to hours for a real-size poll, far too long for a single HTTP request. */
export async function triggerTally(communityId: string, actionId: string, walletAddress: string): Promise<void> {
  if (!(await isAuthorized(communityId, walletAddress))) {
    throw new NotAuthorizedToTallyError();
  }

  const action = await getActionOrThrow(communityId, actionId);
  if (!action.pollAddress || !action.pollId) throw new PollNotDeployedError();
  if (action.tallyStatus !== "not_started" && action.tallyStatus !== "failed") {
    throw new TallyAlreadyInProgressError();
  }
  if (!action.pollEndDate || action.pollEndDate > Math.floor(Date.now() / 1000)) {
    throw new PollNotClosedError();
  }

  const [governanceConfig] = await db
    .select({ contractAddress: maciGovernanceConfigs.contractAddress, chainId: maciGovernanceConfigs.chainId })
    .from(maciGovernanceConfigs)
    .where(eq(maciGovernanceConfigs.communityId, communityId))
    .limit(1);
  if (!governanceConfig || !governanceConfig.contractAddress) throw new ProposalNotFoundError();
  if (governanceConfig.chainId !== SEPOLIA_CHAIN_ID) throw new UnsupportedChainForTallyError();

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(proposals)
    .set({ tallyStatus: "pending", tallyRequestedAt: now, tallyError: null, tallyResult: null })
    .where(eq(proposals.id, actionId));

  void runTallyInBackground(
    actionId,
    governanceConfig.contractAddress,
    action.pollId,
    action.votingProtocolType,
    action.decisionTargetType,
    action.optionMemberAddresses ? (JSON.parse(action.optionMemberAddresses) as string[]) : null,
  );
}

async function runTallyInBackground(
  actionId: string,
  maciContractAddress: string,
  pollId: string,
  votingProtocolType: Proposal["votingProtocolType"],
  decisionTargetType: Proposal["decisionTargetType"],
  optionMemberAddresses: string[] | null,
): Promise<void> {
  try {
    await db.update(proposals).set({ tallyStatus: "processing" }).where(eq(proposals.id, actionId));

    const result = await runTallyPipeline({
      maciContractAddress,
      pollId: Number(pollId),
      mode: VOTING_PROTOCOL_TYPE_TO_MODE[votingProtocolType],
    });

    const electedWalletAddress =
      decisionTargetType === "person" && optionMemberAddresses
        ? resolveElectionWinner(result.tallyData, optionMemberAddresses)
        : null;

    await db
      .update(proposals)
      .set({
        tallyStatus: "completed",
        tallyCompletedAt: Math.floor(Date.now() / 1000),
        tallyResult: JSON.stringify(result.tallyData),
        electedWalletAddress,
      })
      .where(eq(proposals.id, actionId));
  } catch (err) {
    console.error(`[tallyService] Tally failed for governance action ${actionId}:`, err);
    await db
      .update(proposals)
      .set({
        tallyStatus: "failed",
        tallyError: err instanceof Error ? err.message : String(err),
      })
      .where(eq(proposals.id, actionId));
  }
}
