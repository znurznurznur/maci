import { Hono } from "hono";
import { requireAuth } from "../middleware/requireAuth.js";
import { getSession } from "../middleware/session.js";
import {
  createDraftBodySchema,
  formalizeConfirmBodySchema,
  directAuthorizeBodySchema,
  directConfirmBodySchema,
} from "../validators/proposalSchema.js";
import * as proposalService from "../services/proposalService.js";
import {
  NotAuthorizedToCreateError,
  CredentialRequiredError,
  NonExecutableAxisCombinationError,
  IneligibleTiersError,
  ProposalNotFoundError,
  NotAuthorizedToSponsorError,
  AlreadyFormalizedError,
  CreatorNoLongerAuthorizedError,
  NotAuthorizedToFormalizeError,
  ThresholdNotMetError,
  DirectDeploymentDisabledError,
  DraftPathDisabledError,
  NoDecisionAdapterAttachedError,
  InvalidElectionOptionsError,
} from "../services/proposalService.js";
import * as tallyService from "../services/tallyService.js";
import {
  NotAuthorizedToTallyError,
  PollNotDeployedError,
  PollNotClosedError,
  TallyAlreadyInProgressError,
  UnsupportedChainForTallyError,
} from "../services/tallyService.js";

export const proposalsRouter = new Hono();

proposalsRouter.post("/:id/proposals", requireAuth, async (c) => {
  const communityId = c.req.param("id");
  const session = await getSession(c);

  const body = await c.req.json();
  const parsed = createDraftBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 422);
  }

  try {
    const result = await proposalService.createDraft(communityId, session.address!, parsed.data);
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof DraftPathDisabledError) return c.json({ error: err.message }, 403);
    if (err instanceof NoDecisionAdapterAttachedError) return c.json({ error: err.message }, 403);
    if (err instanceof NotAuthorizedToCreateError) return c.json({ error: err.message }, 403);
    if (err instanceof CredentialRequiredError) return c.json({ error: err.message }, 403);
    if (err instanceof NonExecutableAxisCombinationError) return c.json({ error: err.message }, 422);
    if (err instanceof IneligibleTiersError) {
      return c.json({ error: err.message, details: { invalidTierIds: err.invalidTierIds } }, 422);
    }
    if (err instanceof InvalidElectionOptionsError) return c.json({ error: err.message }, 422);
    throw err;
  }
});

proposalsRouter.post("/:id/proposals/direct/authorize", requireAuth, async (c) => {
  const communityId = c.req.param("id");
  const session = await getSession(c);

  const body = await c.req.json();
  const parsed = directAuthorizeBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 422);
  }

  try {
    const result = await proposalService.authorizeDirect(communityId, session.address!, parsed.data);
    return c.json(result);
  } catch (err) {
    if (err instanceof DirectDeploymentDisabledError) return c.json({ error: err.message }, 403);
    if (err instanceof NoDecisionAdapterAttachedError) return c.json({ error: err.message }, 403);
    if (err instanceof NotAuthorizedToCreateError) return c.json({ error: err.message }, 403);
    if (err instanceof CredentialRequiredError) return c.json({ error: err.message }, 403);
    if (err instanceof NonExecutableAxisCombinationError) return c.json({ error: err.message }, 422);
    if (err instanceof IneligibleTiersError) {
      return c.json({ error: err.message, details: { invalidTierIds: err.invalidTierIds } }, 422);
    }
    if (err instanceof InvalidElectionOptionsError) return c.json({ error: err.message }, 422);
    throw err;
  }
});

proposalsRouter.post("/:id/proposals/direct/confirm", requireAuth, async (c) => {
  const communityId = c.req.param("id");
  const session = await getSession(c);

  const body = await c.req.json();
  const parsed = directConfirmBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 422);
  }

  try {
    const proposal = await proposalService.confirmDirect(communityId, session.address!, parsed.data);
    return c.json({ proposal }, 201);
  } catch (err) {
    if (err instanceof DirectDeploymentDisabledError) return c.json({ error: err.message }, 403);
    if (err instanceof NoDecisionAdapterAttachedError) return c.json({ error: err.message }, 403);
    if (err instanceof NotAuthorizedToCreateError) return c.json({ error: err.message }, 403);
    if (err instanceof CredentialRequiredError) return c.json({ error: err.message }, 403);
    if (err instanceof NonExecutableAxisCombinationError) return c.json({ error: err.message }, 422);
    if (err instanceof IneligibleTiersError) {
      return c.json({ error: err.message, details: { invalidTierIds: err.invalidTierIds } }, 422);
    }
    if (err instanceof InvalidElectionOptionsError) return c.json({ error: err.message }, 422);
    throw err;
  }
});

// formalize-communities epic, Child H (/plan-eng-review 2026-08-25, D1) — requireAuth dropped: a
// signed-in (SIWE-authenticated) non-member can now read the unrestricted subset (canView's
// non-member branch, proposalService.ts). A fully anonymous caller (no session at all) still
// isn't newly exposed at the frontend — ProposalsList.tsx's own `enabled: connected` gate is
// unchanged — but at the API layer this route is now reachable with no session, matching every
// other resource in this app (public-ish reads, auth-gated writes).
proposalsRouter.get("/:id/proposals", async (c) => {
  const communityId = c.req.param("id");
  const session = await getSession(c);
  const proposalsList = await proposalService.listForViewer(communityId, session.address);
  return c.json({ proposals: proposalsList });
});

proposalsRouter.get("/:id/proposals/:actionId", async (c) => {
  const communityId = c.req.param("id");
  const session = await getSession(c);
  const result = await proposalService.getForViewer(communityId, c.req.param("actionId"), session.address);
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});

proposalsRouter.post("/:id/proposals/:actionId/sponsor", requireAuth, async (c) => {
  const communityId = c.req.param("id");
  const session = await getSession(c);
  try {
    const result = await proposalService.sponsor(communityId, c.req.param("actionId"), session.address!);
    return c.json(result);
  } catch (err) {
    if (err instanceof ProposalNotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof NotAuthorizedToSponsorError) return c.json({ error: err.message }, 403);
    if (err instanceof AlreadyFormalizedError) return c.json({ error: err.message }, 409);
    throw err;
  }
});

proposalsRouter.post("/:id/proposals/:actionId/formalize/authorize", requireAuth, async (c) => {
  const communityId = c.req.param("id");
  const session = await getSession(c);
  try {
    const result = await proposalService.authorizeFormalize(communityId, c.req.param("actionId"), session.address!);
    return c.json(result);
  } catch (err) {
    if (err instanceof ProposalNotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof NotAuthorizedToFormalizeError) return c.json({ error: err.message }, 403);
    if (err instanceof CreatorNoLongerAuthorizedError) return c.json({ error: err.message }, 403);
    if (err instanceof AlreadyFormalizedError || err instanceof ThresholdNotMetError) {
      return c.json({ error: err.message }, 409);
    }
    throw err;
  }
});

proposalsRouter.post("/:id/proposals/:actionId/formalize/confirm", requireAuth, async (c) => {
  const communityId = c.req.param("id");
  const session = await getSession(c);

  const body = await c.req.json();
  const parsed = formalizeConfirmBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 422);
  }

  try {
    const proposal = await proposalService.confirmFormalize(
      communityId,
      c.req.param("actionId"),
      session.address!,
      parsed.data,
    );
    return c.json({ proposal });
  } catch (err) {
    if (err instanceof ProposalNotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof NotAuthorizedToFormalizeError) return c.json({ error: err.message }, 403);
    if (err instanceof CreatorNoLongerAuthorizedError) return c.json({ error: err.message }, 403);
    if (err instanceof AlreadyFormalizedError || err instanceof ThresholdNotMetError) {
      return c.json({ error: err.message }, 409);
    }
    throw err;
  }
});

proposalsRouter.get("/:id/proposals/:actionId/vote-eligibility", requireAuth, async (c) => {
  const communityId = c.req.param("id");
  const session = await getSession(c);
  try {
    const result = await proposalService.checkVoteEligibility(communityId, c.req.param("actionId"), session.address!);
    return c.json(result);
  } catch (err) {
    if (err instanceof ProposalNotFoundError) return c.json({ error: err.message }, 404);
    throw err;
  }
});

proposalsRouter.post("/:id/proposals/:actionId/tally", requireAuth, async (c) => {
  const communityId = c.req.param("id");
  const session = await getSession(c);
  try {
    await tallyService.triggerTally(communityId, c.req.param("actionId"), session.address!);
    return c.json({ tallyStatus: "pending" }, 202);
  } catch (err) {
    if (err instanceof ProposalNotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof NotAuthorizedToTallyError) return c.json({ error: err.message }, 403);
    if (err instanceof PollNotDeployedError || err instanceof PollNotClosedError) {
      return c.json({ error: err.message }, 409);
    }
    if (err instanceof TallyAlreadyInProgressError) return c.json({ error: err.message }, 409);
    if (err instanceof UnsupportedChainForTallyError) return c.json({ error: err.message }, 422);
    throw err;
  }
});

proposalsRouter.get("/:id/proposals/:actionId/tally", requireAuth, async (c) => {
  const communityId = c.req.param("id");
  try {
    const result = await tallyService.getTallyStatus(communityId, c.req.param("actionId"));
    return c.json(result);
  } catch (err) {
    if (err instanceof ProposalNotFoundError) return c.json({ error: err.message }, 404);
    throw err;
  }
});
