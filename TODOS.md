# TODOS

## ZuGov / Governance restructure Phase 2+ follow-ups (from 2026-08-20 `/plan-eng-review`, Phase 1 scope)

### Confirm MACI's `FULL` mode real semantics

**What:** `EMode.FULL` (`packages/core/ts/Poll.ts`) appears, from a partial read during the terminology review, to involve unused-voice-credit refund behavior distinct from a plain quadratic/non-quadratic vote-counting rule — but this was never confirmed against the actual current protocol implementation in this repo, only inferred from a partial code read. Needs a real answer before `FULL` gets classified anywhere in the new `votingProtocolType`/decision-adapter vocabulary: is it a genuine 3rd voting protocol type, a substrate/circuit detail that doesn't belong in that enum at all, or something else entirely.

**Why:** Explicitly flagged as unresolved, not confirmed, during both the 2026-08-20 governance-terminology review and the Phase 1 `/plan-eng-review` — founder's own call to track it separately rather than let it quietly ride along inside the broader "audit MACI's current protocol state" item below.

**Effort:** S (a focused read of `Poll.ts`'s `FULL`-mode branches + whoever knows MACI's circuits)
**Priority:** P2
**Depends on:** None — informs the eventual `votingProtocolType` classification and decision-adapter capability declarations

### Unified decision-adapter execution interface

**What:** Phase 1's `decisionAdapterService.ts` is a backend capability registry only (which eligibility mechanisms an adapter supports, which decision-taking mechanisms/voting protocol types it offers) — the actual deploy/vote/tally execution stays adapter-specific frontend code (MACI's existing `useDeployPoll`/`useVote`/`useJoinPoll` hooks, refactored to read capabilities from the registry but not unified). Once a second adapter exists (Zupoll-style survey is the likely first), design a real shared execution interface across adapters.

**Why:** Founder's explicit call during the 2026-08-20 governance-restructure review — designing a unified interface against only one real implementation (MACI) risks getting the shape wrong; better to validate against two.

**Effort:** L
**Priority:** P2
**Depends on:** Phase 1 (decision-adapter registry) landing first; at least one non-MACI adapter existing to design against

### Zupoll-style survey decision adapter

**What:** Off-chain, Semaphore-group-proof survey/advisory-vote adapter, matching `julianapeace-zupoll`'s real `Ballot`/`Poll`/`Vote` model (`STRAWPOLL`/`ADVISORYVOTE` ballot types). Fills the "survey" decision-taking mechanism the governance-terminology glossary locked but Phase 1 doesn't build.

**Why:** Confirmed real, planned decision adapter during the 2026-08-20 governance-terminology review, grounded in the actual knowledge-base repo.

**Effort:** L
**Priority:** P2
**Depends on:** Decision-adapter architecture (Phase 1) landing first

### Snapshot-style voting decision adapter

**What:** Off-chain, public, signed-message voting adapter — matches the dominant real-world DAO tool (~96% of major DAOs). Would bring genuine "voting strategy" plurality (token-balance, NFT, delegation-based, mixable) into ZuGov, since Snapshot's own architecture cleanly separates voting _type_ (ballot format) from voting _strategy_ (weight computation) — the same split this glossary locked.

**Why:** Researched during the 2026-08-20 governance-terminology review; strongest real-world precedent for the off-chain/public substrate combination.

**Effort:** L
**Priority:** P2
**Depends on:** Decision-adapter architecture (Phase 1) landing first

### Tally/Governor-style voting decision adapter

**What:** On-chain, public, token-weighted (ERC20Votes) voting adapter with binding timelock execution — matches OpenZeppelin Governor / Tally. Realizes the already-stubbed-but-dead `MECHANISM_FAMILIES: "tokenWeighted"` wizard option for real.

**Why:** Researched during the 2026-08-20 governance-terminology review; direct precedent already half-named in the codebase.

**Effort:** L
**Priority:** P2
**Depends on:** Decision-adapter architecture (Phase 1) landing first

### Voting strategy (voter-power computation)

**What:** A new, currently-unmodeled concept: how much weight one voter's ballot carries — token-balance-based, NFT/credential-based, delegation-adjusted, uniform (today's implicit default), or a composed mix. Orthogonal to voting protocol type (ballot format). Matches Snapshot's real "strategies" concept exactly.

**Why:** Locked in the 2026-08-20 governance-terminology glossary as a real, distinct axis — not built in Phase 1, which only carries forward MACI's existing flat/uniform weighting unchanged.

**Effort:** L
**Priority:** P2
**Depends on:** Decision-adapter architecture (Phase 1) landing first; most naturally lands alongside a token-weighted adapter (Governor-style, above)

### Delegation (vote/survey participation-right assignment)

**What:** An eligible member assigns their voting/survey-participation right to another eligible member, scoped to one proposal or the whole community, revocable. Needs a real `delegations` table (delegator, delegate, scope, active/revoked) — today `canDelegate`/`canBeDelegatedTo` are declared tier flags with zero enforcement (`app/delegates/page.tsx` already says so explicitly).

**Why:** Explicit founder requirement during the 2026-08-20 governance-terminology review; must apply to both voting and survey, not just MACI-voting.

**Effort:** M
**Priority:** P2
**Depends on:** Proposal rename (Phase 1) landing first

### Decision target/type post-proposal enactment automation

**What:** Phase 1 adds a real `decisionTargetType` column (opinion/policy/person) to `proposals`, but doesn't build what happens after the decision is made. For a "person" (election) target: register the elected person on-chain or directly on the community page. For "policy": apply/execute the decided rule. "Opinion" needs no further action.

**Why:** This is where "election"/"referendum" get real operational meaning per the locked glossary (post-proposal action stage) — Phase 1 only adds the classification, not the behavior it should drive.

**Effort:** M (per target type — person-type enactment is the concrete, requested example)
**Priority:** P2
**Depends on:** Proposal rename + decisionTargetType column (Phase 1) landing first

## ZuGov / Governance terminology follow-ups (from 2026-08-20 terminology review)

### Correct "Zupass" in the deferred eligibility adapters list — it's built, just disconnected

**What:** TODOS.md's own "8 deferred eligibility adapters" item lists Zupass as unbuilt. It isn't — `apps/zugov-backend/src/services/identity/zupassAdapter.ts` and `zkidAdapter.ts` are real, working `IdentityProvider` implementations, wired into `routes/credentials.ts`, storing verified/unverified/expired status in the `credentials` table. Neither is called by `eligibilityService.ts`. The fix is a thin `EligibilityAdapter.evaluate()` wrapper reading the already-cached `credentials` row (same shape as the existing `tier` adapter reading an already-stored membership row) — not new proof-verification work.

**Why:** Caught during the 2026-08-20 governance-terminology review while researching the knowledge-base's zupass/zkid repos. zkID isn't on the original deferred list at all.

**Effort:** S (wrapper adapters + list correction)
**Priority:** P2
**Depends on:** Eligibility adapters core (done, 2026-08-19)

### Audit current in-repo MACI protocol state against ZuGov's app-layer assumptions

**What:** `GovernanceActionsList.tsx`'s `TALLY_MECHANISM_TO_MODE` maps `"ranked"` to mode code `"3"` — MACI's `EMode` (`packages/core/ts/Poll.ts`) appeared to only have 3 values (`QV`/`NON_QV`/`FULL`, presumably 0/1/2) as read during this review, which would make `"3"` invalid; `"weighted"` maps to the same code as `"simple"`, collapsing two supposedly-distinct app-layer choices into one on-chain behavior. Founder's note: this read may reflect general/initial MACI documentation rather than the actual current state of this repo's MACI protocol, which may have moved ahead without docs catching up. Needs a real audit of `packages/core`/`packages/contracts`'s current capabilities (Mode enum, Policy types, anything newer) before treating the mapping as a confirmed bug or fixing it.

**Why:** Surfaced during the 2026-08-20 governance-terminology review; explicitly downgraded from "confirmed bug" to "needs audit" per founder correction.

**Effort:** S (audit) + M (fix, once scoped)
**Priority:** P2
**Depends on:** None — informs the eventual decision-adapter rename/rebuild work

### clr.fund-style decision adapter (funding allocation) — on-chain and off-chain/public variants

**What:** A decision adapter for the "funding allocation" decision target/type — quadratic funding distributing a shared matching pool across many proposals based on many small contributions, rather than a single yes/no or ranked choice on one proposal. Two variants: on-chain/privacy-preserving (composing MACI, matching the real clr.fund protocol), and an off-chain/public equivalent of the same mechanism.

**Why:** Confirmed as a real, planned decision adapter during the 2026-08-20 governance-terminology review — real-world precedent researched (clr.fund integrates MACI for anti-collusion in quadratic funding rounds).

**Effort:** L each variant (new decision-taking mechanism, not just a new adapter on an existing one)
**Priority:** P3
**Depends on:** Decision adapter architecture landing first (governance restructure, not yet built)

### Holographic Consensus-style decision adapter — on-chain and off-chain/public variants

**What:** A decision adapter combining token/reputation-weighted voting with a prediction-market-style "boosting" layer that filters which proposals get full-community attention vs. staying scoped to a smaller committee (DAOstack's Genesis Protocol model). Two variants: on-chain (matching the real DAOstack implementation), and an off-chain/public equivalent.

**Why:** Confirmed as a real, planned decision adapter during the 2026-08-20 governance-terminology review.

**Effort:** XL each variant (reputation system + prediction-market mechanics, exotic relative to anything else planned)
**Priority:** P3
**Depends on:** Decision adapter architecture landing first (governance restructure, not yet built)

### Document decision adapters as real repo documentation, not just a planning glossary

**What:** The decision-adapters table (MACI, Zupoll-style, Snapshot-style, Tally/Governor-style, clr.fund-style, Holographic-Consensus-style) currently only lives in a `/plan-eng-review`-adjacent glossary doc. Once the governance restructure locks an actual architecture, this belongs in the repo itself — an `ENGINEERING.md` section or a dedicated `docs/decision-adapters.md` — the same way `ENGINEERING.md` already documents the data model and core architectural principles.

**Why:** Explicit founder ask during the 2026-08-20 governance-terminology review.

**Effort:** S (once the architecture is locked — this is a docs task, not a design task)
**Priority:** P3
**Depends on:** Governance restructure `/plan-eng-review` landing first

## ZuGov / Eligibility adapters follow-ups (from 2026-08-19 `/plan-eng-review`)

### 8 deferred eligibility adapters (MerkleProof, EAS, GitcoinPassport, Zupass, Semaphore, AnonAadhaar, HatsProtocol, ERC20Votes)

**What:** The eligibility-adapters system shipped with exactly 3 adapters (Open, Tier, ERC20Token — chosen to prove off-chain/on-chain/hybrid-via-composition, not driven by current Sepolia deployment status). The other 8 MACI policy types each get their own adapter, one mechanism-registry entry + one Zod config schema branch each — additive once the core pattern exists, no changes needed to the evaluator itself.

**Why:** Full breadth wasn't needed to lock the core abstraction (adapter interface, DNF composition, rank-based tier resolution, enforcement call site) — each remaining adapter is small, isolated work once that foundation exists.

**Effort:** S each (one adapter + one schema branch)
**Priority:** P2
**Depends on:** Eligibility adapters core (done, 2026-08-19)

### Frontend eligibility-ruleset builder UI (creation-time + post-creation)

**What:** Backend ships `POST`/`GET /communities/:id/eligibility-ruleset` with zero resident-facing value until a UI exists — a creator needs to compose AND/OR groups, pick mechanisms, set per-group tier targets, at community creation OR later from the edit page. Same sequencing shape as the Events feature's own frontend follow-up.

**Why:** Dead API surface with no UI is worse than no API at all — flagged explicitly rather than left implicit.

**Effort:** M
**Priority:** P2
**Depends on:** Eligibility adapters core (done, 2026-08-19)

### Proof-based mechanism re-verification UX (Zupass/Semaphore/AnonAadhaar)

**What:** These mechanisms can't be silently re-checked by the system — eligibility requires the user to actively submit a fresh proof, unlike a token-balance check the system can re-verify passively at any time. Needs a real answer once these adapters ship: grace period? re-prove-on-next-visit prompt? something else?

**Why:** Flagged explicitly during the 2026-08-19 review as a genuinely different enforcement model from the 3 adapters that shipped — the adapter interface is shaped so it won't need to change later, but the actual UX is real, deferred work.

**Effort:** M
**Priority:** P3
**Depends on:** At least one proof-based adapter (above) shipping first

### Existing-member re-check sweep after a ruleset change

**What:** Today, a ruleset edit grandfathers every existing member indefinitely (2026-08-19 review, D3 — no resident should lose access from an admin's config edit they never saw happen). A later, explicit re-check mechanism (admin-triggered, or a scheduled sweep) that can flag members who'd now fail the current ruleset is real, deliberately deferred work.

**Why:** D3's grandfather behavior is permanent by default unless this lands — worth tracking so it doesn't quietly become "no admin can ever tighten eligibility and have it mean anything for existing members."

**Effort:** M
**Priority:** P3
**Depends on:** Eligibility adapters core (done, 2026-08-19)

### Flash-loan/flash-mint gaming risk on balance-snapshot adapters (ERC20Token, later ERC20Votes)

**What:** A point-in-time `balanceOf()` read (or, later, `ERC20Votes` snapshot) can be gamed with a flash loan/flash mint executed immediately before the eligibility check, then reversed. More consequential here than a one-time vote-weight snapshot elsewhere in the app, since this determines actual membership/tier grant, not just a single vote's weight.

**Why:** Caught during the 2026-08-19 eligibility-adapters review's outside-voice pass — accepted as a documented, not-solved risk for the initial pass (proper on-chain infrastructure hardening happens before public launch per the founder's own framing), but needs a real mitigation (minimum holding duration, block-delay, or a snapshot-based read) before any high-stakes production use.

**Effort:** M
**Priority:** P2
**Depends on:** None

### RPC caching/rate-limiting for union-eligibility ERC20 checks

**What:** The union eligibility fallback (`evaluateEligibilityAcrossUnion`, 2026-08-19 follow-up review) can trigger up to N sibling `evaluateRuleset` calls per join attempt, short-circuited on first pass but otherwise uncapped. Any sibling using the `erc20_token` mechanism does a live, serially-awaited on-chain `balanceOf()` read with no cache and no rate limit — repeatable by any wallet on every failed join attempt against a union community.

**Why:** Caught during that follow-up review's outside-voice pass. Accepted as a documented, not-solved risk for the initial pass — matches current scale (small unions, few ERC20-gated communities) — but a real cost once ERC20-gated unions grow. A short-lived balance cache (wallet+token+chain) or a join-attempt rate limit are the two obvious mitigations.

**Effort:** S–M (cache) or S (rate limit)
**Priority:** P3
**Depends on:** Union eligibility live-evaluation (this follow-up review's D1)

### Tier-adapter self-reference/cycle documentation

**What:** A group requiring "already holds Tier X" to unlock Tier X itself (or a two-group cycle) isn't detected anywhere today — it's a config-time footgun, not a crash (a self-referential rule is simply always false, fails closed). Worth real creator-facing documentation once the ruleset-builder UI exists.

**Why:** Flagged during the 2026-08-19 review's outside-voice pass; not blocking since it fails safely, but a creator hitting it with no explanation is a real, avoidable confusion.

**Effort:** S
**Priority:** P3
**Depends on:** Frontend eligibility-ruleset builder UI (above)

## ZuGov / Union communities follow-ups (from 2026-08-18 eng review)

### Events (one-time/recurring) as a first-class concept — backend implementation

**What:** Full schema + API locked by the 2026-08-19 `/plan-eng-review` (18 decisions, including an outside-voice pass): `events`, `venues`, `eventRsvps` tables anchored to `communities.id`, a new `canCreateEvents` tier permission, RSVP-only in v1 (check-in deferred to the Contribution layer TODO below), recurring events as independent rows sharing an optional `seriesId` (no RRULE engine), venue as its own reusable entity gated on `canManageMembership`, event edit/cancel as creator-OR-`canManageMembership` (not creator-only — the outside voice caught that the original creator-only design broke ENGINEERING.md's own "authorization is one reusable pattern" rule), a transactional `duplicate()` endpoint (capped at 52) plus a series-scoped bulk-cancel endpoint, and a paginated list endpoint matching `communities.ts`'s existing convention.

**Why:** No longer "unscoped" — this review fully designed it, including a cross-model outside-voice pass that caught 9 real gaps the interactive review alone missed (admin override, venue-creation permission, read-visibility, series lifecycle, batch-size cap, pagination, others noted in the review's findings).

**Context:** Backend-only. The outside voice flagged that Events is P3 while two P1/P2 items (wallet funding, MerkleProof factory deploy) directly block the live Sept 9 pilot, and this ships zero resident-facing value without a frontend pass — founder's explicit call was to proceed anyway as deliberate backend groundwork, with frontend tracked as its own separate TODO (below) rather than silently deferred.

**Effort:** L (3 new tables, ~11 routes, full test coverage per the review's test plan at `~/.gstack/projects/znurznurznur-maci/isasertkaya-main-eng-review-test-plan-20260819-081939.md`)
**Priority:** P3
**Depends on:** None — hard constraint (anchor to `communities.id`, never `maciGovernanceConfigs`) already satisfied by the identity/governance split, which has landed.

### Events frontend (calendar/list/create UI)

**What:** List view (grouped by date, not a calendar grid — see the follow-up item below), create/edit-event modal, RSVP toggle, venue picker — the UI layer for the Events backend above. Locked via a 2026-08-19 `/plan-design-review`: kind shows as a monochrome icon+label (not a colored badge — DESIGN.md's single-accent rule), no kind/date filters in v1 (deferred, small event counts don't need them yet), Edit reuses the create modal in a pre-filled/PATCH mode, Cancel/cancel-series use an inline "Are you sure? confirm" affordance rather than `window.confirm()` (matching this session's earlier wallet-sign-out fix), and the new modal gets Escape-key close + `role="dialog"`/`aria-modal` (no existing modal in this app has either — see the a11y follow-up item below).

**Why:** The backend ships with zero resident-facing value until this lands — flagged by the outside-voice pass during the 2026-08-19 eng review as a real sequencing gap, tracked explicitly rather than left implicit.

**Effort:** M (eventApi.ts, EventsSection.tsx, CreateEventModal.tsx, wired into the community detail page)
**Priority:** P2 (higher than the backend's own P3 once the backend actually ships — dead API surface with no UI is worse than no API at all)
**Depends on:** Events backend (above) landing first

### Events calendar grid view

**What:** A month/week calendar-grid view for Events, toggled from the list view — actual grid cells with day numbers, not just a chronological list grouped under date headers.

**Why:** TODOS.md's original item name was "calendar/list view," but the 2026-08-19 `/plan-design-review` scoped the first pass down to list-only — a real calendar grid is a materially bigger build (grid math, cell click targets, mobile grid collapse) with no existing grid-UI precedent anywhere in this app, and small pop-up-city event counts don't need it yet. Tracked explicitly so the "calendar" half of the original name isn't silently dropped.

**Effort:** L (new grid-layout component, month/week navigation, mobile collapse behavior — no reusable precedent in the codebase)
**Priority:** P3
**Depends on:** Events frontend (above) landing first

### Modal accessibility retrofit (Escape-key close + role="dialog")

**What:** Add Escape-key close and `role="dialog"`/`aria-modal="true"` to `CreateGovernanceActionModal` and `AuthModal` — the two existing modals in the app, neither of which has either today.

**Why:** Caught during the 2026-08-19 Events `/plan-design-review` (Pass 6, Responsive & Accessibility) while checking precedent for the new `CreateEventModal`. Keyboard-only and screen-reader users currently cannot close either existing modal without a mouse click on the X icon or the backdrop — a real accessibility gap, not cosmetic polish. The new Events modal gets both fixes as new code; this item is the retrofit for the two that predate it.

**Effort:** S (one small hook/utility shared across both modals — Escape listener + two ARIA attributes)
**Priority:** P3
**Depends on:** None

### Nested `{ identity, governance }` API response shape

**What:** Expose the `communities`/`maciGovernanceConfigs` split explicitly in API responses, instead of the flat-merged shape (+ `governanceConfigured` flag) locked in this review's Issue 3.

**Why:** More honest about the actual data model, and becomes actually useful once — if ever — a second governance backend exists and "flat merge" stops being a clean 1:1 join.

**Context:** Deliberately deferred because it would force every frontend read site (community detail page, manage-communities, GovernanceActionsList, JoinSection) to change for what is otherwise a purely internal storage refactor. Only revisit if a second governance backend actually gets built — until then this is speculative.

**Effort:** M (touches every frontend community-read call site)
**Priority:** P3
**Depends on:** A second governance backend existing (currently: none)

## ZuGov / Lightpaper alignment

### Build the Contribution layer (badges, credentials, peer endorsement)

**What:** The Lightpaper's second layer — verifiable credentials/badges for contributions (organizing an event, writing code, hosting a session) that feed into a resident's standing in a community, plus peer-endorsement flows to issue them. Nothing in `zugov-backend`'s schema or `zugov-frontend` today models a "contribution" or "credential" as a first-class object — `membershipTiers` is a static role a wallet is assigned to, not something earned through activity.

**Why:** Identified during a wizard-vs-lightpaper comparison (2026-08-18): the current MVP ships the Community layer (this session's parent-child work) and a thin slice of the Voice layer (MACI voting), but the Contribution layer — the mechanism that's supposed to make voice/role earned rather than assigned — doesn't exist yet.

**Context:** Out of scope for Zukas 2026 (Sept 9-20, 2026); the event needs sybil-resistant polling and resident onboarding, not a full contribution economy. Revisit once the communities-first foundation (this session's work) is live and there's a real backlog of contributions to credential.

**Effort:** XL (new data model, credential issuance flow, likely a verifiable-credentials or EAS integration)
**Priority:** P3
**Depends on:** None architecturally, but sequenced after the Community layer (done) since contribution credentials need to attach to something

### Voice weighted by reputation/contribution, with role decay

**What:** The Lightpaper describes voting power that scales with contribution/reputation (not flat one-wallet-one-vote or purely tier-assigned) and roles that decay over time without continued participation — so influence reflects ongoing engagement, not a one-time grant.

**Why:** Today, `membershipTiers` grants fixed, non-decaying permissions (`canVote`, `canCreateGovernanceActions`, etc.) set once at tier assignment. MACI's quadratic/weighted voting modes exist at the protocol level (`supportedModes`), but nothing computes a reputation-derived voice-credit amount — `initialVoiceCreditAmount` is a static per-community constant, not derived from a resident's contribution history.

**Context:** Depends on the Contribution layer above existing first (decay/weighting needs something to decay/weight against). Flagged in the same 2026-08-18 lightpaper comparison.

**Effort:** L
**Priority:** P3
**Depends on:** Contribution layer (badges/credentials) above

### Coordination/federation layer across communities

**What:** The Lightpaper's fourth layer — cross-community coordination: shared proposals, resource pooling, or delegated representation between a parent community and its sub-communities (or between peer communities), beyond simple hierarchical nesting.

**Why:** This session added structural parent-child nesting (a `parentCommunityId` column and sub-community listing), which covers "communities and sub-communities as first-class components" but not the coordination mechanics on top — a parent community currently has no way to act on behalf of, aggregate votes from, or coordinate a joint decision with its children.

**Context:** The nesting primitive is a prerequisite for this and now exists. Federation mechanics are a much larger design question (delegation rules, cross-community quorum, conflicting membership) that needs its own design pass, not an MVP add-on.

**Effort:** XL
**Priority:** P3
**Depends on:** Communities/sub-communities nesting (done, 2026-08-18)

## Repo Infrastructure

### Manually fund each resident's embedded wallet with Sepolia test ETH

**What:** After a resident signs up via email (Privy auto-provisions an embedded wallet), the wallet has 0 Sepolia ETH and cannot sign any transaction (MACI signup, voting). Tarik/Sait need to manually send test ETH to each resident's wallet address (visible in the Privy dashboard or via the app) before that resident can actually participate.

**Why:** No auto-funding path exists anywhere in the codebase (`src/config.ts` only lists manual faucet _links_ — Google Cloud Web3 Faucet, QuickNode, etc. — not an automated flow). Discovered during eng review's outside-voice pass, alongside the `window.ethereum` signer bug it's adjacent to (fixed separately).

**Context:** Given the small expected headcount for Zukas 2026 and Sepolia's free public faucets, this is an operational workaround, not a blocker — but it's a real step that must actually happen for each resident, and it's easy to forget under event-day pressure. Consider batch-funding all registered residents' addresses in one pass right before the event rather than one-by-one reactively.

**Effort:** S (operational, not engineering)
**Priority:** P1
**Depends on:** None — but blocks any embedded-wallet resident from actually signing up/voting until done

### Deploy MerkleProof policy factory to Sepolia

**What:** `policyFactories.merkleProof.policy` and `.checker` in `apps/zugov-frontend/src/generated/sepolia.ts` are both `0x0000...0000`. Deploy the MerkleProofPolicy factory (contract already exists at `packages/contracts/tasks/deploy/maci/01-policies.ts:535-589`) to Sepolia, then regenerate `sepolia.ts` via `syncFrontendConfig.ts`.

**Why:** Without this, `deployPolicyContract()` throws "Policy factories for MerkleProof are not deployed on this network" the moment anyone tries to use it — blocking real on-chain sybil-resistant poll eligibility beyond the default FreeForAll.

**Context:** Deferred out of the Zukas 2026 (Sept 9-20, 2026) MVP after eng review found it needs its own bootstrap step (a required, non-optional `root` field in `deploy-config.json` before the factory can even come up), not the "thin wiring" originally assumed. Founder decided the communities-first wizard redesign and wallet custody are higher priority for the live event; Zukas 2026 ships with backend-only (app-layer) eligibility gating via `checkVoteEligibility()` in `governanceActionService.ts`, on-chain policy stays FreeForAll. Revisit once the wizard/wallet work lands.

**Effort:** M
**Priority:** P2
**Depends on:** None (independent of wizard/wallet work, but explicitly deprioritized behind it)

### Build Merkle allowlist tooling (root + per-resident proof generation)

**What:** New zugov-backend endpoint(s): given a community's approved `memberships` list, generate a Merkle root (at poll creation) and serve each resident their individual proof (at vote time), using the already-existing `generateMerkleTree()` helper in `packages/contracts/ts/utils.ts:157` (returns an OpenZeppelin `StandardMerkleTree` — same primitive the upstream MACI test suite uses in `MerkleProofPolicy.test.ts`).

**Why:** `CreateProposalModal.tsx`'s MerkleProof input is currently a raw hex text box — no way for a non-technical poll creator to generate a root from a resident list, and no way for residents to get their own voting proof. Without this, MerkleProof stays unusable through the app even after the policy factory is deployed.

**Context:** Also need to document the "allowlist locks at poll creation" rule found during test review — a resident approved into the community after a poll's root is already deployed on-chain will have a proof that doesn't verify against the stale root. That needs to be a clear, non-silent error, not just a test.

**Effort:** S (thin wiring around an existing utility, not new cryptography)
**Priority:** P2
**Depends on:** Deploy MerkleProof policy factory to Sepolia (above)

### Dedupe checkVoteEligibility()'s two DB round-trips

**What:** `checkVoteEligibility()` in `governanceActionService.ts:363-380` calls `hasTierPermission()` then separately `getMemberTier()` — two round trips to the same `memberships` ⋈ `membershipTiers` join for the same wallet/community pair. Combine into one query returning both the permission flag and tier ID.

**Why:** Not a real N+1 (no loop over N rows) and low-impact at Zukas's scale, but it's a duplicate query on a hot path (every vote-eligibility check), and it's exactly the kind of thing that compounds once ZuGov has more than one small pilot community.

**Context:** Flagged in eng review's Performance section; founder deferred rather than fix inline to keep the reviewed diff tight to the Merkle/wizard/wallet work.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Full accessibility audit for CreateCommunityWizard

**What:** Screen reader testing, ARIA landmarks, and full a11y pass beyond the minimum bar (keyboard nav, touch targets, contrast) specified in the Sept 9 design review.

**Why:** Minimum bar covers immediate risk for the live event; a real audit (not just spot-checks) is separate, valuable work.

**Context:** Surfaced in plan-design-review Pass 6. No accessibility testing has been done on any part of zugov-frontend to date.

**Effort:** M
**Priority:** P3
**Depends on:** None

### Investigate passkey/smart-contract-wallet auth as a Privy replacement

**What:** Replace Privy's custodial-ish embedded wallet with a genuinely vendor-free path: WebAuthn passkeys signing through a smart contract wallet (ERC-4337 account abstraction + ERC-1271 signature verification), instead of a standard EOA/SIWE flow.

**Why:** Privy (and every embedded-wallet SDK evaluated — Dynamic, Web3Auth, Magic) means real vendor lock-in. Passkeys are the only path that avoids a wallet-infrastructure vendor entirely, and fit ZuGov's own values (minimizing trusted third parties) better than any custodial/MPC SaaS option.

**Context:** Researched during T1 (2026-08-18) and explicitly rejected for Sept 9 because it's the heaviest option, not the lightest: (1) WebAuthn uses secp256r1, Ethereum uses secp256k1 — mathematically incompatible, so this REQUIRES a smart contract wallet, not a simple key swap. (2) P-256 verification costs ~330k-400k gas without the RIP-7212 precompile (~$25/signature at L1 prices); RIP-7212 is deployed on major L2s but its status on plain Ethereum Sepolia (the chain locked in for Zukas 2026) is unconfirmed — check this first before any implementation attempt. (3) Requires an ERC-4337 bundler — either self-hosted (real new production infrastructure, arguably bigger than the MACI coordinator ops work) or a commercial bundler (Alchemy, Pimlico, Biconomy, ZeroDev, etc.) — which is still a vendor, just one layer lower. (4) `useSiwe.ts` and backend `auth.ts`/`session.ts` assume standard EOA `personal_sign` verification; a smart contract wallet needs ERC-1271 verification instead — real rework, not a provider swap. Worth revisiting once there's time to do it properly, not under event-deadline pressure.

**Effort:** XL
**Priority:** P3
**Depends on:** Confirming RIP-7212 precompile availability on the target chain (or moving to an L2 where it's confirmed live)
