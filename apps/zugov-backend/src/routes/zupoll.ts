import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth.js";
import { getSession } from "../middleware/session.js";
import * as membershipService from "../services/membershipService.js";
import * as communityService from "../services/communityService.js";
import { attach, listAvailable } from "../services/decisionAdapterService.js";
import * as proposalService from "../services/proposalService.js";
import {
  NoDecisionAdapterAttachedError,
  NotAuthorizedToCreateError,
  CredentialRequiredError,
  NonExecutableAxisCombinationError,
  IneligibleTiersError,
} from "../services/proposalService.js";
import * as zupollService from "../services/zupollService.js";
import {
  InvalidCommitmentError,
  ZupollProposalNotFoundError,
  InvalidVoteProofError,
  DuplicateVoteError,
  ProposalClosedError,
  NotAuthorizedToWithdrawError,
  VotesAlreadyCastError,
} from "../services/zupollService.js";
import { zupollCreateBodySchema } from "../validators/proposalSchema.js";

// Two router instances, mirroring the existing convention of multiple routers sharing a base
// path (e.g. six routers all mounted at "/api/communities" in app.ts) — one for
// community-scoped operations (mounted at "/api/communities"), one for proposal-scoped
// operations that need no communityId in their path at all (mounted at "/api/proposals").
// Mounting a single router at both prefixes would double up path segments.
export const zupollCommunityRouter = new Hono();
export const zupollProposalRouter = new Hono();

// research.md #10 — DoS mitigation for the two routes below that are deliberately public and do
// non-trivial work (ZK proof verification; serializing a potentially large commitment list) and
// therefore can't be throttled per-wallet/session the way every other write route in this
// codebase is (that would defeat research.md #3's anonymity requirement). A simple in-memory
// fixed-window counter keyed by remote IP — a mitigation, not a complete fix (shared IPs, VPNs
// can still exceed it), documented as a known, accepted residual risk rather than left
// unaddressed.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const requestCounts = new Map<string, { count: number; windowStart: number }>();

function rateLimit(): MiddlewareHandler {
  return async (c: Context, next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown";
    const now = Date.now();
    const entry = requestCounts.get(ip);

    if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      requestCounts.set(ip, { count: 1, windowStart: now });
      return next();
    }

    if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
      return c.json({ error: "Too many requests" }, 429);
    }

    entry.count += 1;
    return next();
  };
}

const semaphoreProofSchema = z.object({
  merkleTreeDepth: z.number().int().nonnegative(),
  merkleTreeRoot: z.string().min(1),
  message: z.string().min(1),
  nullifier: z.string().min(1),
  scope: z.string().min(1),
  points: z.array(z.string()),
});

const castVoteBodySchema = z.object({
  proof: semaphoreProofSchema,
});

const registerIdentityBodySchema = z.object({
  commitment: z.string().min(1),
});

// --- Attach the Zupoll adapter ------------------------------------------------------------

zupollCommunityRouter.post("/:id/decision-adapters", requireAuth, async (c) => {
  const communityId = c.req.param("id");
  const session = await getSession(c);

  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({ adapterType: z.literal("zupoll") }).safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 422);
  }

  if (!(await membershipService.isAuthorized(communityId, session.address!))) {
    return c.json({ error: "Not authorized" }, 403);
  }

  // Union-as-community merge (2026-08-28, D11) — found while wiring union content authorization
  // into proposals: this route is a SEPARATE path to giving a community a decision adapter,
  // independent of communityService.attachGovernance() (which is already guarded). Without this
  // check a union could attach the zupoll adapter and fully bypass "governance is deferred for
  // unions" — not just get a bare maciGovernanceConfigs row, but an actually-votable proposal
  // pipeline.
  const community = await communityService.get(communityId);
  if (community?.type === "union") {
    return c.json({ error: "Decision adapters cannot be attached to a union" }, 422);
  }

  await attach(communityId, "zupoll");
  return c.json({ communityId, adapterType: "zupoll" as const }, 201);
});

zupollCommunityRouter.get("/:id/decision-adapters", async (c) => {
  const adapters = await listAvailable(c.req.param("id"));
  return c.json({ adapters: adapters.map((a) => a.adapterType) });
});

// --- Create / withdraw a Zupoll proposal --------------------------------------------------

zupollCommunityRouter.get("/:id/zupoll/proposals", async (c) => {
  const proposals = await zupollService.listProposals(c.req.param("id"));
  return c.json({ proposals });
});

zupollCommunityRouter.post("/:id/zupoll/proposals", requireAuth, async (c) => {
  const communityId = c.req.param("id");
  const session = await getSession(c);

  const body = await c.req.json();
  const parsed = zupollCreateBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 422);
  }

  try {
    const proposal = await proposalService.createZupollProposal(communityId, session.address!, parsed.data);
    return c.json({ proposal }, 201);
  } catch (err) {
    if (err instanceof NoDecisionAdapterAttachedError) return c.json({ error: err.message }, 403);
    if (err instanceof NotAuthorizedToCreateError) return c.json({ error: err.message }, 403);
    if (err instanceof CredentialRequiredError) return c.json({ error: err.message }, 403);
    if (err instanceof NonExecutableAxisCombinationError) return c.json({ error: err.message }, 422);
    if (err instanceof IneligibleTiersError) {
      return c.json({ error: err.message, details: { invalidTierIds: err.invalidTierIds } }, 422);
    }
    throw err;
  }
});

zupollProposalRouter.post("/:proposalId/withdraw", requireAuth, async (c) => {
  const session = await getSession(c);
  try {
    const result = await zupollService.withdraw(c.req.param("proposalId"), session.address!);
    return c.json(result);
  } catch (err) {
    if (err instanceof ZupollProposalNotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof NotAuthorizedToWithdrawError) return c.json({ error: err.message }, 403);
    if (err instanceof VotesAlreadyCastError) return c.json({ error: err.message }, 409);
    throw err;
  }
});

// --- Anonymous identity registration ------------------------------------------------------

zupollCommunityRouter.post("/:id/zupoll/identity", requireAuth, async (c) => {
  const communityId = c.req.param("id");
  const session = await getSession(c);

  const body = await c.req.json();
  const parsed = registerIdentityBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 422);
  }

  try {
    const result = await zupollService.registerCommitment(session.address!, communityId, parsed.data.commitment);
    return c.json(result);
  } catch (err) {
    if (err instanceof InvalidCommitmentError) return c.json({ error: err.message }, 422);
    throw err;
  }
});

// --- Public: group read, vote cast, tally read --------------------------------------------
// Deliberately NOT behind requireAuth (research.md #3) — do not add session auth to these routes.

zupollProposalRouter.get("/:proposalId/zupoll/group", rateLimit(), async (c) => {
  const group = await zupollService.getGroup(c.req.param("proposalId"));
  if (!group) return c.json({ error: "Not found" }, 404);
  return c.json(group);
});

zupollProposalRouter.post("/:proposalId/zupoll/vote", rateLimit(), async (c) => {
  const proposalId = c.req.param("proposalId");

  const body = await c.req.json();
  const parsed = castVoteBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 422);
  }

  try {
    const result = await zupollService.verifyAndRecordVote(proposalId, parsed.data.proof);
    return c.json(result);
  } catch (err) {
    if (err instanceof ZupollProposalNotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ProposalClosedError) return c.json({ error: err.message }, 410);
    if (err instanceof DuplicateVoteError) return c.json({ error: err.message }, 409);
    if (err instanceof InvalidVoteProofError) return c.json({ error: err.message }, 422);
    throw err;
  }
});

zupollProposalRouter.get("/:proposalId/zupoll/tally", async (c) => {
  const proposalId = c.req.param("proposalId");
  const nullifier = c.req.query("nullifier");

  try {
    const result = await zupollService.getTally(proposalId, nullifier);
    return c.json(result);
  } catch (err) {
    if (err instanceof ZupollProposalNotFoundError) return c.json({ error: err.message }, 404);
    throw err;
  }
});
