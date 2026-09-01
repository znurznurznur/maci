# TODOS

## ZuGov / Governance restructure Phase 3+ follow-ups (from 2026-08-20 Phase 2 implementation)

### Tally pipeline integration test coverage

**What:** `tallyService.ts`'s `triggerTally`/`runTallyInBackground` have zero integration test coverage anywhere in the repo — pre-existing, not introduced by Phase 2. Phase 2 added direct unit coverage for the pure `resolveElectionWinner` function (the only new logic in the pipeline) but didn't build the coordinator-mocking harness (`vi.mock` on `coordinatorClient.ts`'s HTTP calls, a real `maciGovernanceConfigs` test row) needed to exercise `runTallyInBackground` end to end — no existing test file does this for any tally-related behavior, so it would be new test infrastructure, not an extension of an existing pattern.

**Why:** The Phase 2 eng review's Test Review diagram flagged "non-person-type → electedWalletAddress stays null" and "tally fails → electedWalletAddress untouched" as regression-check gaps. Both turned out to be structurally guaranteed by the actual code (a ternary short-circuit for the first, the field being absent from the failure-path `.set()` call for the second) rather than genuine runtime risk — but that's true by code-reading, not by a test that would catch it if someone later changed the code and broke the guarantee.

**Effort:** M (building the coordinator-mock + governance-config test harness is the real cost; the assertions themselves are simple once it exists)
**Priority:** P2
**Depends on:** None

### ~~Confirm MACI's `FULL` mode real semantics~~ — RESOLVED (2026-08-20 Phase 2 `/plan-eng-review`)

**Resolution:** Confirmed by reading `packages/core/ts/Poll.ts:349-473` directly. `EMode.FULL` is a genuine, distinct 4th voting protocol type, not a substrate/circuit detail: on each message, it resets every OTHER vote option's ballot weight to zero and assigns the full new weight to only the selected option (`Poll.ts:395-399`), and requires the voter to spend their entire remaining voice-credit balance in that single message — any leftover credits throw `InvalidVoiceCredits` (`Poll.ts:377-379`). Credit-cost math is linear (non-quadratic), same formula as `NON_QV`/`RANKED` (`Poll.ts:466-472`). In plain terms: "single-choice, mandatory full-commitment" voting — not a refund mechanism as originally speculated. Belongs in `votingProtocolType` as a real, distinct value; `decisionAdapterService.ts`'s MACI capability declaration should be updated to include it (Phase 2 plan, T2, Architecture Finding 5, not yet implemented).

**Depends on:** None

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
**Depends on:** Proposal rename (Phase 1) landing first; **and, per the 2026-08-20 Phase 2 `/plan-eng-review`'s Architecture Finding 4, a real survey decision adapter (Zupoll-style) existing** — the "must apply to both voting and survey" requirement can't be honestly built while survey doesn't exist as a decision-taking mechanism at all. Building a voting-only version now would either leave the requirement unmet or force a re-scope once survey lands; deferred entirely rather than half-built.

### Decision target/type post-proposal enactment automation — person-type case IN PROGRESS (Phase 2)

**What:** Phase 1 adds a real `decisionTargetType` column (opinion/policy/person) to `proposals`, but doesn't build what happens after the decision is made. Phase 2 (2026-08-20 `/plan-eng-review`) scopes and builds the "person" case: `optionMemberAddresses` links each option to a real member, and tally completion resolves the winning option to `electedWalletAddress` (record + community-page badge only — no new on-chain write, no new roles/permissions system; see the "Elected-roles table with permissions" TODO below for that fuller version, deferred). "Policy" (apply/execute the decided rule) and "opinion" (needs no further action) stay unbuilt.

**Why:** This is where "election"/"referendum" get real operational meaning per the locked glossary (post-proposal action stage) — Phase 1 only added the classification, not the behavior it should drive.

**Effort:** M (person-type case, in progress) + M (policy-type case, still unscoped)
**Priority:** P2
**Depends on:** Proposal rename + decisionTargetType column (Phase 1) landing first

### Elected-roles table with permissions

**What:** A first-class "elected role" concept, separate from `membershipTiers`, giving a person-type proposal's winner real enforced standing (permissions, visibility) in the community — not just a recorded address. Likely shape: a new `electedRoles` table (`communityId` FK CASCADE, `proposalId` FK CASCADE, `walletAddress`, `grantedAt`), one row per proposal — not a mutation of `membershipTiers`.

**Why:** The fuller version of "register the elected person" that the original glossary wording implied. Phase 2 ships the minimal version (`proposals.electedWalletAddress` + a display badge) deliberately, since no product spec yet defines what an elected role should actually grant beyond a tier.

**Effort:** M
**Priority:** P3
**Depends on:** Phase 2's `electedWalletAddress` column landing first (gives it a real winner to grant the role to); a real product spec for what the role grants

### Member display-name system

**What:** `memberships` (`schema.ts`) has only `walletAddress` — no display name, ENS resolution, or nickname anywhere in the app. Every UI surface that shows a member today truncates the raw address.

**Why:** Surfaced by Phase 2's person-type enactment work (2026-08-20 `/plan-eng-review`, Architecture Finding 2) — the member picker and "Elected: 0x1234…abcd" badge both work fine with raw addresses, but this gap will keep resurfacing (delegate picker once delegation lands, elected-roles display, any future member-facing list). ENS resolution is a well-trodden, low-risk pattern (client-side, doesn't even require a schema change) but not every wallet has an ENS name; a self-set nickname needs a new column + edit UI. Deciding ENS-only vs. nickname vs. both needs a product call, not a code decision.

**Effort:** S (ENS-only) to M (nickname system)
**Priority:** P2
**Depends on:** None technically; wants a product decision on ENS vs. nickname vs. both before scoping

## ZuGov / Governance terminology follow-ups (from 2026-08-20 terminology review)

### Correct "Zupass" in the deferred eligibility adapters list — it's built, just disconnected

**What:** TODOS.md's own "8 deferred eligibility adapters" item lists Zupass as unbuilt. It isn't — `apps/zugov-backend/src/services/identity/zupassAdapter.ts` and `zkidAdapter.ts` are real, working `IdentityProvider` implementations, wired into `routes/credentials.ts`, storing verified/unverified/expired status in the `credentials` table. Neither is called by `eligibilityService.ts`. The fix is a thin `EligibilityAdapter.evaluate()` wrapper reading the already-cached `credentials` row (same shape as the existing `tier` adapter reading an already-stored membership row) — not new proof-verification work.

**Why:** Caught during the 2026-08-20 governance-terminology review while researching the knowledge-base's zupass/zkid repos. zkID isn't on the original deferred list at all.

**Effort:** S (wrapper adapters + list correction)
**Priority:** P2
**Depends on:** Eligibility adapters core (done, 2026-08-19)

### ~~Audit current in-repo MACI protocol state against ZuGov's app-layer assumptions~~ — RESOLVED (2026-08-20 Phase 2 `/plan-eng-review`)

**Resolution:** No bug. `packages/core/ts/utils/constants.ts:12-17` defines `EMode` with **4** values, not 3: `QV=0, NON_QV=1, FULL=2, RANKED=3`. `tallyService.ts`'s existing `VOTING_PROTOCOL_TYPE_TO_MODE` mapping (`{quadratic:0, simple:1, full:2, ranked:3, weighted:1}`) already matches this exactly — `"ranked" → 3` is a real, valid mode, not an out-of-range value. `"weighted"` has no distinct on-chain `EMode` counterpart at all (there is no `WEIGHTED` value in the enum), so aliasing it to `NON_QV` (mode `1`, same as `"simple"`) is an honest fallback, not a collision bug — "weighted" voting isn't a real MACI protocol concept yet, only an app-layer aspiration. `decisionAdapterService.ts`'s MACI capability declaration should be updated (Phase 2 plan, T2, Architecture Finding 5, not yet implemented) to include `"ranked"` and `"full"` as genuinely supported, with a comment explaining `"weighted"`'s alias status.

**Depends on:** None

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

### ~~Events (one-time/recurring) as a first-class concept — backend implementation~~ — RESOLVED (2026-08-25, Child I of formalize-communities epic)

**Resolution:** Shipped exactly as designed by the 2026-08-19 `/plan-eng-review`: `events`, `venues`, `eventRsvps` tables anchored to `communities.id`, `canCreateEvents` tier permission, RSVP-only, recurring events as independent rows sharing `seriesId`, venue as its own `canManageMembership`-gated entity, creator-OR-`canManageMembership` edit/cancel, transactional `duplicate()` (capped at 52), series-scoped bulk-cancel, and a paginated list endpoint. All confirmed live and covered by `tests/events.test.ts` (62 cases as of the 2026-08-26 events-expansion work). Never struck through when it originally shipped — caught while checking TODOS.md for events-related items during that later work.

**Depends on:** None

### ~~Events frontend (calendar/list/create UI)~~ — RESOLVED (2026-08-25, Child I of formalize-communities epic)

**Resolution:** Shipped as designed by the 2026-08-19 `/plan-design-review`: `EventsSection.tsx` (date-grouped list, monochrome kind icon+label, no filters in v1), `CreateEventModal.tsx` (create/edit, inline cancel confirm, Escape-key close + `role="dialog"`), `eventApi.ts`, wired into the community detail page. Never struck through when it originally shipped — caught while checking TODOS.md for events-related items during the 2026-08-26 events-expansion work.

**Depends on:** None

### Events calendar grid view

**What:** A month/week calendar-grid view for Events, toggled from the list view — actual grid cells with day numbers, not just a chronological list grouped under date headers.

**Why:** TODOS.md's original item name was "calendar/list view," but the 2026-08-19 `/plan-design-review` scoped the first pass down to list-only — a real calendar grid is a materially bigger build (grid math, cell click targets, mobile grid collapse) with no existing grid-UI precedent anywhere in this app, and small pop-up-city event counts don't need it yet. Tracked explicitly so the "calendar" half of the original name isn't silently dropped.

**Effort:** L (new grid-layout component, month/week navigation, mobile collapse behavior — no reusable precedent in the codebase)
**Priority:** P3
**Depends on:** Events frontend (above) landing first

### ~~`/unions/page.tsx` silently shows the empty state on a fetch failure~~ — RESOLVED (2026-08-27)

**Resolution:** Added a distinct `isError` branch ("Couldn't load unions right now." + Retry button), same shape as the fix that landed on the new `/events` page. Covered by a new test in `app/unions/page.test.tsx` ("shows a distinct error state (not the empty state) on fetch failure, with a working Retry").

**Depends on:** None

### Events creation-flow polish (Approach B: kind taxonomy, recurring UI, real date-range picker, nested schedule view)

**What:** The richer creation-flow additions named as Approach B in the 2026-08-26 events-expansion design doc, deliberately deferred out of Approach A (side-events + global feed, shipped 2026-08-27): expand the `kind` enum to match Sola.day's taxonomy (talk/panel/workshop/activity/seminar/conference/meetup/networking/training/exhibition/hackathon/demo_day/social/open_mic/wellness/other, vs. today's 5 values), a "Repeat" option at creation time (wraps the existing `duplicate()` endpoint in real creation-flow UI instead of the current post-hoc `DuplicateForm` on an already-created event), an "All day" toggle + real multi-day date-range picker (today's create modal only has two raw `datetime-local` inputs), and a nested-schedule-by-day view on a parent event's page (today's side-events render as a flat indented list under the parent, not grouped by day).

**Why:** Named explicitly in both the design doc ("Approach A now, Approach B's additions as an explicit named follow-up") and the eng review's "NOT in scope" section, but never actually written into `TODOS.md` as its own trackable item — it only existed as prose inside two planning docs, invisible to anyone scanning this file for open events work. Caught while auditing events-related TODOS.md entries after Approach A shipped.

**Effort:** L (kind-enum migration touches the DB column + every kind-rendering call site; the date-range picker and nested-schedule view are both new, no existing precedent in this app)
**Priority:** P3
**Depends on:** Approach A (side-events + global feed) — shipped 2026-08-27

### Community-level timezone field for all-day event boundaries

**What:** Add a real `timezone` column to `communities`, and use it (not the event creator's browser offset) whenever an all-day event's local-midnight boundary is computed, or in any future calendar display.

**Why:** Caught during the 2026-08-27 `/plan-eng-review` for Approach B's all-day toggle (outside-voice finding) — there is zero timezone concept anywhere in this schema today. The locked fallback ("creator's browser timezone at creation time") is fine for a single-location pop-up-city event, but a real gap for a multi-timezone case: an organizer creating from one timezone and an attendee viewing from another could see the same all-day event span different calendar days.

**Effort:** M (new column + backfill for existing communities + a settings UI to set/edit it — a real, separate piece of scope from the all-day toggle itself)
**Priority:** P3
**Depends on:** None

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

## ZuGov / Auth architecture follow-ups (from 2026-08-22 `/office-hours` + `/plan-eng-review`)

### ~~Roll out shared 401-detect wrapper to all write call sites~~ — RESOLVED (2026-08-23, Batches 1-4)

**What:** A `/plan-eng-review` pass (2026-08-23) audited every authenticated write call
site precisely, replacing this entry's old "~40 call sites" estimate: **31 real write
functions** across 6 service files, of which **21 have zero 401-handling** (2 more —
`eventApi.ts`'s `createVenue`/`cancelSeries` — turned out to be dead code, deleted in
Batch 1). Batch 1 (implemented this pass) covers `communityApi.ts`'s own internal
consistency (only 3 of its 8 writes auto-signed-out on a 401; now all 8 do, via the new
`withAuthDetect` wrapper in `src/services/httpClient.ts`) plus `membershipApi.ts`'s two
real landmines (`app/manage-communities/[id]/members/page.tsx`'s `handleApprove`/
`handleReject` had NO catch clause at all — worse than a swallow, a bare
`try {...} finally {...}` — now fixed).

**Batch 2 (implemented 2026-08-23) — DONE.** `membershipApi.ts`'s 3 remaining writes
(`createTier`, `updateTier`, `deleteTier`) plus `eligibilityApi.ts`'s `replaceRuleset`
(pulled forward from Batch 4) all get called from the same `edit/page.tsx`
`handleSubmit`, alongside `communityApi.update`'s edit-page call site — which turned
out to be a call site Batch 1's own audit had already flagged as inconsistent
(`communityApi.ts:200-218 update`'s TWO call sites: the wizard's, wrapped via
`withAuthRetry`; this edit page's, left on the old generic catch) but Batch 1's
Implementation Tasks never actually listed it, so it got missed. Fixed now: the whole
5-call save sequence (`update` → tier CRUD loop → `replaceRuleset`) is wrapped in ONE
`withAuthDetect` call, not one per call — they're one atomic "save" action from the
user's perspective, so a 401 anywhere in the sequence should sign out exactly once.

**Batch 3 (implemented 2026-08-23) — DONE.** `proposalApi.ts`'s 7 writes, across 2
call-site files: `CreateProposalModal.tsx` (`authorizeDirect`/`confirmDirect`/
`createDraft` — one atomic submit, one `withAuthDetect` wrap around the whole
`handleSubmit` body, matching Batch 2's edit-page precedent) and `ProposalsList.tsx`
(4 separate wraps in 3 components: `DeployPollPrompt.handleDeploy` for
`confirmFormalize`, `TallySection.handleTally` for `triggerTally`, and
`DraftRow`'s two independent handlers — `handleSponsor` for `sponsor` and
`runAuthorizeIfReady` for `authorizeFormalize` — kept as separate wraps since they're
two logically distinct actions with two distinct error-state variables, not one
sequence).

**Batch 4 (implemented 2026-08-23) — DONE.** `eventApi.ts`'s 6 live writes across 2
call-site files: `CreateEventModal.tsx` (`createEvent`/`updateEvent` — one atomic
submit, one `withAuthDetect` wrap around the whole `handleSubmit` body) and
`EventsSection.tsx` (3 separate wraps: `DuplicateForm.handleSubmit` for
`duplicateEvent`, `EventRow.handleRsvpToggle` for `rsvp`/`cancelRsvp` — one atomic
toggle, one wrap — and `EventRow.handleCancelConfirm` for `cancelEvent`). Plus
`credentialApi.ts`'s `verify`, wrapped inside `useCredentialScan.ts`'s `checkZupass` —
this file had its own hand-rolled duplicate of `parseErrorOr`'s logic (not one of the
original 4 counted in Batch 1's DRY extraction), migrated to the shared
`parseErrorOr`/`HttpError` in the same pass.

**Post-rollout re-verification (2026-08-23) caught one real miss:**
`app/community/[id]/JoinSection.tsx`'s two `membershipApi.join()` call sites
(`handleJoin`, `handleJoinBackendOnly`) were never wrapped in any of the 4 batches.
They already surfaced errors correctly (from an earlier, unrelated 2026-08-21 fix), so
Batch 1's audit didn't flag them as "swallowing" landmines — but nobody had gone back
to actually wire in the sign-out-on-401 behavior once `withAuthDetect` existed. Fixed:
both call sites now wrapped. This is exactly the same shape of miss as Batch 2's —
"already looks fine" is not the same check as "is it wrapped" — worth remembering for
any future rollout of this kind: audit for the wrapper's actual presence, not just for
whether the existing behavior already looks acceptable.

**Minor, non-blocking consistency gap found in the same re-verification:**
`communityApi.ts` never actually migrated to the shared `parseErrorOr` — its 8 write
functions still use bespoke inline `if (res.status === 401/403/409)` blocks (or the
file's own `handleCommunityResponse` helper) instead of the shared helper extracted in
Batch 1. Functionally harmless (`AuthError extends HttpError(401)` still makes
`isAuthError()`/`withAuthDetect()` work correctly), but it's the one file that never
got the DRY cleanup the other 5 did. Low priority — a pure refactor with no behavior
change, worth doing next time this file is touched for another reason, not on its own.

**All batches now complete, independently re-verified.** Every one of the 31 real
write functions (29 live + 2 confirmed-dead, deleted) across all 6 service files now
either already had 401-handling (the original 8 `communityApi.ts` functions) or has
`withAuthDetect` wired in. The "structural instead of opt-in" question (below) is the
only related work still open.

**Effort (actual, all batches + the post-rollout fix):** ~5 sessions, 1 new shared file
(`src/services/httpClient.ts`), ~20 files touched across service layer + call sites +
tests
**Priority:** was P1 (same root cause already produced 6 live bugs in one session
during pre-Zukas-2026 dogfooding)
**Depends on:** N/A — complete.

### Make 401-detection structural instead of opt-in (global interceptor)

**What:** `withAuthDetect` (Batch 1) is opt-in per call site — every write function's
call site must remember to wrap itself. Nothing structurally prevents a future write
function (in Batches 2-4, or any new endpoint added later) from being written without
it, reproducing the exact bug class this rollout exists to fix. Alternative: register a
global `signOut` callback once from `SiweProvider` (e.g. via a module-level mutable
reference set in a `useEffect`); the shared `parseErrorOr`/`HttpError` path in
`httpClient.ts` calls it automatically on any 401, with no per-call-site wrapping
required at all — every current AND future write gets 401-handling for free.

**Why:** Raised by this review's outside-voice pass (Claude subagent, Codex not
installed) as a genuine architecture gap in the opt-in design. Not built now because
this exact tradeoff (opt-in vs. a bigger consolidated mechanism) was already weighed
and decided at the parent SiweProvider `/plan-eng-review`: Approach B (a consolidated
API client with built-in 401-handling, zero-touch for future call sites) was rejected
in favor of Approach A (opt-in wrapper) because its bigger blast radius wasn't
justified by what was broken at the time. Revisiting it now, with the shared
`HttpError`/`parseErrorOr` foundation already in place from Batch 1, is a smaller
version of the same idea and may be worth it once Batches 2-4 reveal whether opt-in
wrapping keeps getting missed in practice.

**Open design question:** callback-registration timing — `SiweProvider` mounts once at
app root, but does the global callback exist before the very first API call fires after
app boot (e.g. a component's own `useEffect` firing before `SiweProvider`'s registration
effect)? Needs its own design pass, not a quick patch.

**Effort:** M (touches `SiweProvider` + `httpClient.ts`; needs a design pass for the
registration-timing question)
**Priority:** P2
**Depends on:** Batch 1 landing first (needs the shared `HttpError`/`parseErrorOr`
foundation to build on).

### ~~Unify Privy's wallet-connect signature and ZuGov's own SIWE signature~~ — RESOLVED (2026-08-23, Privy removed)

**Resolution:** Both candidate directions from the original write-up turned out to be
dead ends: Option A (bypass Privy's own wallet-auth signature, keep Privy only for
`embeddedWallets`) was blocked by `wagmiConfig.ts` importing `createConfig` from
`@privy-io/wagmi` — wagmi's connector state was entirely Privy-driven, with no
independent raw wagmi connector existing anywhere in the app, making "just bypass
Privy for external wallets" a real unknown-feasibility spike, not a simple change.
Option B (one signature satisfying both) was confirmed architecturally infeasible —
Privy's own "bring your own SIWE flow" API (`useLoginWithSiwe`/`generateSiweMessage`)
still requires PRIVY'S OWN generated message/nonce for its own replay protection, not
an arbitrary caller-supplied one.

Founder's call once both were ruled out: drop Privy entirely rather than find a third
option — "supporting both Privy and raw wagmi seems to be burdensome and causing
problems." A `/plan-eng-review` (2026-08-23) scoped and shipped the full removal:
plain wagmi `WagmiProvider` (a real registered `injected()` connector in
`wagmiConfig.ts`, replacing Privy's own wagmi bridge), `WalletConnectButton.tsx`
replacing `PrivyConnectButton.tsx`, `useSiwe.tsx`'s auto-sign-in effect no longer
gated on `usePrivy().authenticated` (nothing left to wait on). One signature now,
by construction — not two sequenced ones.

**Accepted tradeoff:** email/social sign-in and Privy's auto-provisioned embedded
wallet are gone with no in-house replacement yet — explicitly confirmed by the
founder ("wallet-only for now, accept the tradeoff") given the 401/403/route-guard
work this was bundled with needed a clean auth foundation before Zukas 2026. See
"Investigate passkey/smart-contract-wallet auth" below, now the only path back to
non-wallet-owning residents, and the now-obsolete embedded-wallet-funding TODO below.

**Depends on:** N/A — complete.

### Per-community configurable visibility policy (public vs. members-only)

**What:** Let each community choose what non-members can see — e.g. proposals/events
visible to everyone vs. members-only — as a real, per-community setting (a new field
on `communities`, checked at the route level per resource), not a single hardcoded
app-wide rule. Distinct from the 3-pattern gating-mechanism inconsistency (which page
uses SiweGate vs. wallet-only vs. no gating) — this is about what content is visible
at all, independent of which mechanism enforces it.

**Why:** Raised directly by the founder during the 2026-08-22 `/office-hours` premise
discussion — an explicit, different frame from "unify the auth mechanism," surfaced
mid-session and deliberately scoped out of the auth-unification wedge rather than
folded in silently.

**Effort:** M (schema field + per-resource route checks; UI for admins to set it)
**Priority:** P2
**Depends on:** Auth architecture unification (this pass + the 401-rollout TODO above)
landing first — a reliable "is this user authenticated" answer needs to exist before
building a visibility policy on top of it.

### ~~Consolidate the 3 uncoordinated auth-gating patterns across pages~~ — RESOLVED (Phase B, 2026-08-23)

**Resolution:** All 3 concrete gating bugs fixed, plus the route-guard mechanism built
and applied per the locked plan:

1. **`manage-communities/[id]/members`** — the byte-identical "You don't have
   permission" text is gone. The load failure now branches on the real `HttpError`
   status (`isAuthError`/new `isForbiddenError`, both in `src/services/httpClient.ts`):
   a 401 shows "Sign in to review join requests for this community." with a real
   "Sign in with Ethereum" button (wired to retry the fetch once `isAuthenticated`
   flips true), a 403 keeps the original permission-denied text, and anything else
   (network error, 500) now surfaces its own message instead of being lumped into
   "forbidden."
2. **`/community/:id`'s Join button** (`JoinSection.tsx`) — the governed-community
   branch's Join button is now `SiweGate`-wrapped, matching its ungoverned sibling.
   Auto-sign-in means this renders straight through to the button for the common case;
   the gate only surfaces when auto-sign-in hasn't (yet) succeeded.
3. **`manage-communities/[id]/edit`** — "Save Changes" is now `SiweGate`-wrapped (button
   only, not the whole form — matches the register page's own placement exactly). The
   page-level `isAuthorized` view gate (creator-or-admin wallet check) was left
   wallet-based on purpose — deciding who sees the edit UI at all is a legitimate
   wallet-address check; the fix targets the WRITE bypassing `SiweGate`, not the view
   gate's shape.

**`RequireAuth`** (new file, `app/components/RequireAuth.tsx`) — a react-router-dom v6
layout route, applied to exactly `/manage-communities` and `/manage-profile` per the
locked scope. Gates on `useAccount().address` (wallet connected — the same "connected"
concept every other page already uses), not a SIWE session, with a loading state for
wagmi's reconnect-on-mount window (matching `WalletConnectButton`'s same check) so a
returning connected user never sees a false "Connect your wallet" flash. Verified live
in the browser: `/manage-communities` and `/manage-profile` now show a clear "Connect
your wallet to view this page." prompt instead of the old misleading "You don't own any
communities yet." empty state.

**`isForbiddenError(err)`** added alongside `isAuthError` in `httpClient.ts`, used by
the members-page fix above. The backend-side 403 response-SHAPING unification (a
shared dispatcher matching 401's `requireAuth`, replacing the two ad-hoc idioms across
`communities.ts`/`membership.ts`/etc.) was NOT part of this pass — frontend-only,
matching what the 3 concrete bugs and the route-guard actually needed. Revisit
separately if the backend-side inconsistency becomes a real problem, not just a
documented one.

**Why:** Found during the 2026-08-22 auth audit; fully scoped during the 2026-08-23
Privy-removal `/plan-eng-review` (founder: "removing privy support needs to be full on
auth, 401, 403 handling, route guards and all, with unified gating").

**Verification:** Full frontend suite (209 tests, 30 files) + typecheck both pass; new
tests added for `RequireAuth` (4), the members-page 401/403 split + sign-in retry (3),
and the governed-Join-button gating (2). Live-browser-verified via `/browse` for both
guarded routes.

**Depends on:** N/A — complete.

### WalletConnect/mobile-wallet support

**What:** `wagmiConfig.ts` registers only a single `injected()` connector (auto-
discovers every EIP-6963 browser-extension wallet — MetaMask, Rabby, Coinbase
extension, etc. — under one entry), no `walletConnect()` connector for QR-code/mobile
wallet flows.

**Why:** Deliberately deferred during the 2026-08-23 Privy-removal `/plan-eng-review`
— adding it needs a new WalletConnect Cloud project ID, a new vendor dependency the
review didn't want to pull in in the same pass as the Privy removal it was meant to
simplify.

**Effort:** S (one new connector + a WalletConnect Cloud project ID)
**Priority:** P3
**Depends on:** None

### No rate limiting on `/api/auth/nonce` / `/api/auth/verify`; nonce not cleared on failed verify

**What:** Neither auth endpoint has rate limiting (confirmed: no rate-limit dependency
anywhere in `apps/zugov-backend`'s `package.json`). A failed `/api/auth/verify` doesn't
clear the session's nonce (only a successful verify does), so one session can throw
unlimited verify attempts at one nonce within its 5-minute TTL.

**Why:** Found during the 2026-08-22 auth audit. Not an authentication bypass (a valid
ECDSA signature is still required), but a real defense-in-depth gap.

**Effort:** S (a small rate-limit middleware; clearing the nonce on failure is a
one-line change to the `/verify` handler's failure path)
**Priority:** P3
**Depends on:** None

### `CORS_ORIGIN` missing env var crashes the backend at boot with a cryptic error

**What:** `apps/zugov-backend/src/app.ts`'s `process.env.CORS_ORIGIN!.split(",")` uses
a non-null assertion with no runtime guard — an unset/empty `CORS_ORIGIN` crashes the
whole backend at module load with "Cannot read properties of undefined (reading
'split')" instead of a clear, actionable error.

**Why:** Found during the 2026-08-22 auth audit. Contrast with the fail-loudly-with-
setup-instructions pattern this codebase otherwise favors for missing required config.

**Effort:** S (one explicit guard + error message, matching the frontend's pattern)
**Priority:** P3
**Depends on:** None

### Proposals are the only resource with auth-gated reads

**What:** Every route in `apps/zugov-backend/src/routes/proposals.ts` requires
`requireAuth`, including the two `GET` reads — the only resource in the backend where
reads require authentication. Every other resource (communities, events, venues,
eligibility rulesets, membership tiers, unions) has public `GET`s and auth-gated
writes only.

**Why:** Found during the 2026-08-22 auth audit. Unconfirmed whether this is
deliberate (proposal contents treated as sensitive) or an accidental over-restriction
— a logged-out visitor can browse a community's events and venues but can't view its
proposals at all, inconsistent with the rest of the app.

**Effort:** S (if a deliberate-intent confirmation says to open the reads up) to
unknown (if there's a real reason proposals need to stay gated, worth documenting why)
**Priority:** P3
**Depends on:** A product decision on whether proposal content should be public

## ZuGov / Member count consistency (found 2026-08-23 dogfooding)

### Communities show an incorrect/inconsistent member count

**What:** "Member count" is not one number in this codebase — it's at least 4 different
counters from 2 unrelated data sources, with nothing reconciling them:

1. What's actually displayed everywhere (community page, home page, manage-communities
   page) is `fetchMembers()` (`apps/zugov-frontend/src/services/subgraph.ts:120-127`),
   which queries the **on-chain MACI subgraph's `totalSignups`** — only wallets that
   completed the on-chain MACI signup transaction.
2. The Postgres `memberships` table (`apps/zugov-backend/src/db/schema.ts:205-214`) has
   no `status` column — every row counts. Exposed only via `GET /:id/members`
   (`membershipService.listMembers`), used solely for an election candidate picker,
   never rendered as a count anywhere.
3. A hardcoded `0` (`apps/zugov-frontend/src/lib/communityDisplay.ts:49`,
   `communityToItem`) shown before the subgraph query resolves, or for governance types
   the subgraph doesn't support.
4. `joinRequests` filtered to `status = "pending"` powers the "Pending Join Requests"
   count on `manage-communities/[id]/members/page.tsx` — easy to mistake for a member
   count (the page is literally named ".../members") but it's a request queue, not a
   roster; approved/rejected requests are invisible there.

The concrete divergence a user sees: `communityService.createIdentity`
(`apps/zugov-backend/src/services/communityService.ts:363-368`) always inserts the
creator into `memberships` at community-creation time, but the creator is never
auto-registered on-chain — so a brand-new community shows "0 members" (the on-chain
count everyone sees) even though the creator already "has membership" in the DB. Same
gap for anyone whose join request is approved (`approveRequest`,
`membershipService.ts:375-403`, DB-only) but who never separately completes
`JoinSection`'s on-chain MACI signup step — approved in the backend, invisible in the
number everyone else sees.

**Why:** Reported live during 2026-08-23 dogfooding. Root-caused via `/investigate` —
not a regression, this reflects the same identity/governance split already documented
in `ENGINEERING.md` ("on-chain state index is ground truth, the backend membership row
is secondary bookkeeping" — see also `JoinSection.tsx`'s own comments) — but nobody has
reconciled the _displayed count_ the two sides produce. A field-name collision makes it
worse: `unionService.listAll`'s `memberCount` (active `unionMemberships` rows) counts
**communities in a union**, not wallets in a community, yet unions and communities
render under the identical UI field `members` on the merged discovery/home page
(`communityDisplay.ts`'s `communityToItem`/`unionToItem`).

**Fix direction (not yet decided):** Two real options, deliberately not chosen yet:
(A) show the DB `memberships` count everywhere instead of on-chain `totalSignups` —
matches what "member" means everywhere else in the app (join requests, tiers,
permissions), shows a number immediately at creation; needs a new backend COUNT
endpoint plus swapping ~4 frontend call sites off `fetchMembers` for display purposes
(on-chain signup count likely still matters for voting-eligibility contexts,
just not as "member count"). (B) keep on-chain count as displayed, but auto-trigger
MACI signup whenever a DB membership is created — bigger change, adds a blockchain
transaction to the creation/approval flow, and doesn't fully close the gap for
communities without governance configured yet (identity can predate governance,
per `ENGINEERING.md`).

**Effort:** M (new backend query + ~4 frontend call-site swaps for option A; a
deploy-flow change touching creation/approval for option B)
**Priority:** P1 (a visibly wrong number on every community-facing page, live in
front of Zukas 2026 dogfooders)
**Depends on:** A decision between fix direction A vs. B — needs its own scoping
pass, not a blind pick

## ZuGov / Schema timestamp columns are Y2038-limited (found 2026-08-23 investigating event dates)

### Every `*At` timestamp column is a 32-bit Postgres `integer` — overflows in January 2038

**What:** While root-causing "event creation accepts garbage dates" (fixed: added a 5-year
sane-future bound to `createEventSchema`/`updateEventSchema` in
`apps/zugov-backend/src/routes/events.ts`), the regression test for the fix revealed the
_real_ failure mode underneath: before the bound existed, submitting a startAt corresponding
to year ~2126 didn't just get silently accepted — it crashed with a raw, unhandled 500 at
the DB layer. `apps/zugov-backend/src/db/schema.ts`'s `events.startAt`/`endAt`
(`integer("start_at")`) are Postgres 4-byte `integer` columns, max value 2,147,483,647 —
which corresponds to **2038-01-19T03:14:07Z**, the classic Unix Y2038 problem. Every other
timestamp column in the schema (`createdAt`, `joinedAt`, `expiresAt`, `sponsoredAt`,
`rsvpedAt`, `respondedAt`, and ~20 more — grep `integer(".*[Aa]t")` in schema.ts) uses the
same `integer` type; only `events.startAt`/`endAt` are user-controllable far enough into the
future to trigger it _today_ (everything else gets stamped with `Date.now()` at write time,
so it won't overflow until 2038 actually arrives — at which point every one of those columns
breaks app-wide simultaneously, not just events).

**Why:** The 5-year bound just added keeps `events.startAt`/`endAt` safely under the 2038
ceiling for the next several years (2026 + 5 = 2031), so this isn't an active production
outage — but it's a deliberate stopgap sitting on top of a real landmine, not a fix for it.
Two things make it worse than "years away, not urgent": (1) `duplicateEventSchema`
(`routes/events.ts`) has an unbounded `intervalDays` (`z.number().int().min(1)`, no max) —
`eventService.duplicate()` computes `source.startAt + intervalDays * 86400 * i` directly,
bypassing `createEventSchema`'s bound entirely, so a large `intervalDays` can still overflow
the column today, right now, via a second code path the events fix didn't touch. (2) A raw
500 (not a clean 4xx) on integer overflow means the failure mode is an unhandled exception,
not a validated rejection — the same shape of bug could resurface anywhere else a
user-controlled offset gets added to a stored timestamp.

**Fix direction (not scoped/decided):** Migrating all ~30 timestamp columns from `integer`
to `bigint` (or Postgres `timestamptz`, arguably the more correct type) is a real schema
migration — data migration for every existing row, Drizzle schema changes across every table,
and auditing every service that reads/writes these columns for narrowing assumptions. This is
architecture-review territory (`/plan-eng-review`), not a quick patch, and shouldn't be scoped
under time pressure. In the meantime, `duplicateEventSchema`'s `intervalDays` should get the
same kind of sane-bound treatment `createEventSchema` just got (small, targeted fix, unlike
the full migration).

**Effort:** S (bounding `intervalDays`, matching this session's events fix) now available as
a quick follow-up; L-XL (full `integer` → `bigint`/`timestamptz` migration across the schema)
for the real fix
**Priority:** P2 (not urgent — 2038 is ~12 years out and the immediate reported bug is fixed
— but a real ticking liability, and the `duplicateEventSchema` gap is exploitable today)
**Depends on:** None for the `intervalDays` bound; the full migration needs its own
`/plan-eng-review` given the blast radius across every table

## Repo Infrastructure

### ~~Drizzle migration snapshots (`drizzle/meta/*.json`) drifted from reality since migration 0019~~ — RESOLVED (2026-08-24)

**Resolution:** Root cause confirmed: `0019_proposal_rename.sql`'s real SQL
(`ALTER TABLE governance_actions RENAME TO proposals`, etc.) did rename the tables
correctly, but Postgres never auto-renames a table's own constraints on `RENAME TO` —
`proposal_sponsors`'s primary key stayed named
`governance_action_sponsors_governance_action_id_wallet_address_`. `drizzle/meta`'s
0019/0020 snapshots were never regenerated to reflect the rename at all (identical to
0018's), which is what made `drizzle-kit generate` ask its ambiguous "new table or
rename" prompt.

Fixed via `drizzle-kit introspect` against the live, already-correct `zugov_dev` DB
(rather than hand-editing complex snapshot JSON, or fighting the ambiguous interactive
prompt) — only the LATEST snapshot matters for `generate`'s diffing, so the historical
0018/0019/0020 snapshots were left alone; a freshly-introspected, correctly-chained
snapshot became the new baseline. Two follow-on migrations landed alongside
`0021_add_zupoll_tables.sql`: `0022_rename_proposal_sponsors_pk.sql` (the actual root-
cause fix — a single `RENAME CONSTRAINT`, completing what `0019` should have done) and
`0023_reconcile_introspected_index_metadata.sql` (a one-time, fully no-op drop+recreate
of 2 indexes — introspected index metadata isn't byte-identical to schema.ts-declared
index metadata even for the same index, which `drizzle-kit generate` flagged once).

**Verified two ways:** (1) `drizzle-kit generate` now reports "No schema changes,
nothing to migrate 😴" against current `schema.ts` — confirmed stable across a second
`generate` call. (2) The full migration chain (`0000` through `0023`) applied cleanly,
end to end, against a brand-new empty database (`zugov_migration_test`, dropped after
verification) — proving this is a reproducible fix for any fresh clone or CI run, not
just a patch on one already-mutated local DB. Full backend suite: 293/294 passing (1
pre-existing skip).

**Depends on:** N/A — complete.

### ~~Manually fund each resident's embedded wallet with Sepolia test ETH~~ — OBSOLETE (2026-08-23, Privy removed)

**Resolution:** Moot. The premise was Privy auto-provisioning a zero-balance embedded
wallet for email sign-ups, which Tarik/Sait would then need to manually fund one by
one. Privy (and its embedded-wallet path) is gone as of the 2026-08-23 auth
`/plan-eng-review` — every resident now connects their own external wallet (MetaMask
etc.), which they're responsible for funding themselves (public Sepolia faucets are
still linked in `src/config.ts`). No more per-resident manual funding step for the
team to remember under event-day pressure — a positive side-effect of the removal,
not something that needs separate follow-up.

**Depends on:** N/A — obsolete.

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

### Investigate passkey/smart-contract-wallet auth for in-house email/passkey sign-in

**What:** A genuinely vendor-free path back to non-wallet-owning residents: WebAuthn
passkeys signing through a smart contract wallet (ERC-4337 account abstraction +
ERC-1271 signature verification), instead of a standard EOA/SIWE flow.

**Why:** Originally framed as "a Privy replacement" — now more directly load-bearing:
the 2026-08-23 Privy-removal `/plan-eng-review` dropped email/social sign-in entirely
(accepted tradeoff, "wallet-only for now"), with no in-house replacement built yet.
This is the only scoped path back to it. Passkeys also avoid a wallet-infrastructure
vendor entirely, fitting ZuGov's own values (minimizing trusted third parties) better
than any custodial/MPC SaaS option (Privy, Dynamic, Web3Auth, Magic) would have.

**Context:** Researched during T1 (2026-08-18) and explicitly rejected for Sept 9 because it's the heaviest option, not the lightest: (1) WebAuthn uses secp256r1, Ethereum uses secp256k1 — mathematically incompatible, so this REQUIRES a smart contract wallet, not a simple key swap. (2) P-256 verification costs ~330k-400k gas without the RIP-7212 precompile (~$25/signature at L1 prices); RIP-7212 is deployed on major L2s but its status on plain Ethereum Sepolia (the chain locked in for Zukas 2026) is unconfirmed — check this first before any implementation attempt. (3) Requires an ERC-4337 bundler — either self-hosted (real new production infrastructure, arguably bigger than the MACI coordinator ops work) or a commercial bundler (Alchemy, Pimlico, Biconomy, ZeroDev, etc.) — which is still a vendor, just one layer lower. (4) `useSiwe.ts` and backend `auth.ts`/`session.ts` assume standard EOA `personal_sign` verification; a smart contract wallet needs ERC-1271 verification instead — real rework, not a provider swap. Worth revisiting once there's time to do it properly, not under event-deadline pressure.

**Effort:** XL
**Priority:** P3
**Depends on:** Confirming RIP-7212 precompile availability on the target chain (or moving to an L2 where it's confirmed live)

## ZuGov / Formalize communities follow-ups (from 2026-08-24/25 `/plan-eng-review`, Child C1)

### Admin UI for category management

**What:** A simple admin UI (or at minimum a documented runbook — psql/drizzle-studio) for
adding/editing rows in the new `categories` table, instead of a direct DB insert.

**Why:** Child C1 (`specs/20260824-172112-25086-formalize-communities-creation-flow-access-tiers-on-chain.md`)
deliberately ships with no admin UI — adding a 7th category is a direct DB insert by design, so a
7th category doesn't require a code deploy. That's fine at current scale (DB access is trivial for
the founder), but becomes real friction the moment someone other than the founder needs to add a
category, or once the DB isn't something every contributor has direct access to.

**Effort:** S
**Priority:** P3
**Depends on:** Child C1 landing first (the `categories` table has to exist)

### No aggregate pending-union-invite view after Child D's relocation

**What:** Some kind of central "you have pending union invites" signal — a count badge on
`/manage-communities`, a notification, or similar — for a wallet that owns/admins multiple
communities.

**Why:** Before Child D, `/manage-communities` showed every owned community's pending union
invites in one place. After Child D moves accept/decline/invite/leave to each community's own
settings page, a wallet managing N communities has to visit N separate settings pages to find out
if any has a pending invite waiting — no aggregate view or count exists anywhere (verified: no
notification/badge pattern exists in `Header.tsx` today). Flagged during Child D's
`/plan-eng-review` (2026-08-25, outside-voice finding) as a real, accepted UX regression, not built
now because a notification/badge system is real new infrastructure disproportionate to that
child's scope.

**Effort:** M (needs an actual notification/badge pattern designed, not just this one use case)
**Priority:** P2
**Depends on:** Child D landing first

## ZuGov / Formalize communities follow-ups (from 2026-08-25 `/ship` Review Army)

### Landing-page categories/communities fetch is a serial waterfall, not parallel

**What:** `app/page.tsx`'s initial fetch effect gates `fetchCommunities` on the categories
query's `isLoading` flag, so the communities+unions fetch doesn't start until the categories
fetch has already resolved — a serial waterfall on cold cache instead of the two independent
requests firing concurrently.

**Why:** This is the ship-time fix for the double-fetch regression (categories resolving
after mount was giving `fetchCommunities` a new identity via `categoryLabels` and re-firing
the effect) — correctness over parallelism was the deliberate tradeoff at fix time. Flagged
by the Review Army's performance specialist as a follow-on cost worth tracking separately.

**Effort:** S (look up `categoryLabels` via a ref or lazy re-map instead of closing over it
in `fetchCommunities`'s dependency array, so the initial fetch no longer needs to wait)
**Priority:** P3
**Depends on:** None

### Backfill script for `maci_governance_configs.contract_address` checksum normalization isn't wired into deploy

**What:** Migration `0025_third_swordsman.sql` adds a unique index on `contractAddress`
assuming all existing rows are already checksum-normalized; `backfillContractAddressChecksum.ts`
exists to do that normalization but is only runnable manually (`pnpm run
db:backfill-contract-address-checksum`) — it isn't invoked by `deploy-backend.yml`, a
postmigrate hook, or CI. Confirmed the gap is actually worse than "a human might forget it":
the backend's runtime Docker image is a `pnpm deploy --prod` output with no `src/` and no
`tsx` (a devDependency), so the script as written can't even run from inside the deployed
container — it can only be run from a full repo checkout with a direct DB connection.

**Why:** Caught by the Review Army's data-migration specialist during the formalize-communities
ship. Real risk is low right now (pre-production, and the only pre-existing
`maci_governance_configs` row is the seed data, already checksummed as part of this same
change), but the structural gap — a migration that silently depends on an out-of-band manual
step to be fully correct — would resurface for any future backfill of this shape.

**Effort:** S–M depending on direction: (a) teach the deploy image to run one-off backfill
scripts (compile them into `dist/`, keep a slim `tsx`+`src` path available in the runtime
image just for this), or (b) accept manual-only forever and just document the runbook step
explicitly in `LOCAL_DEV.md`/a deploy checklist so it's not tribal knowledge.
**Priority:** P2
**Depends on:** A decision on whether one-off DB backfill scripts deserve their own
deploy-image support, or should stay a documented manual runbook step

### `GET /api/categories` response includes an unused `createdAt` field beyond its declared frontend type

**What:** `communityService.listCategories()` returns `Pick<Category, "id" | "label">` now
(fixed during ship-time review), matching `communityApi.ts`'s frontend `Category` type
exactly. No follow-up needed — noted here only because two other, lower-value findings from
the same review pass are logged below it.

**Why:** N/A — already fixed inline during the 2026-08-25 `/ship` Review Army pass.

**Depends on:** N/A — complete.

### Old `/manage-communities/:id/edit` route is only client-redirected, not a real HTTP 301

**What:** The permanent redirect from the deleted `/manage-communities/:id/edit` route to
`/community/:id/settings` (Child C1) is a React Router `<Navigate>` — a 200 response with a
client-side redirect, not a server-level 301 with a `Location` header. A bookmarked deep link
opened cold, or any non-browser/non-JS consumer of the old URL, gets a real page load before
redirecting rather than a transparent redirect.

**Why:** Flagged by the Review Army's API-contract specialist. Low priority — this app has no
non-SPA consumers of its frontend routes today (no bots, no server-rendered deep links, no
external link-sharing surface that would care about SEO transfer).

**Effort:** S (would need a static redirect rule at the hosting/edge layer, not app code)
**Priority:** P3
**Depends on:** None

### `communities.category` (FK to `categories.id`) has no supporting index

**What:** The new `communities.category` column (Child C1) references `categories.id` with
`ON DELETE SET NULL` but has no index of its own — a future category-scoped lookup on
`communities`, or a category delete, requires a full table scan.

**Why:** Flagged by the Review Army's data-migration specialist. Non-urgent at current scale
(pre-production row count, and no admin path exists yet to delete a category — see the "Admin
UI for category management" TODO above).

**Effort:** S (one migration adding `index("communities_category_idx").on(table.category)`)
**Priority:** P3
**Depends on:** None

## ZuGov / Formalize communities follow-ups (from 2026-08-25 `/plan-eng-review`, Child F)

### Leave for governed communities (on-chain MACI or off-chain zupoll)

**What:** Child F's Leave action (delete your own `memberships` row) is scoped to fully ungoverned
communities only. Members of a governed community — MACI on-chain, or zupoll off-chain — have no
way to leave.

**Why:** MACI's case is blocked on the existing P1 member-count-divergence bug (TODOS.md, "Member
count consistency" section above) — MACI's on-chain signup is permanent, and allowing Leave to
delete the backend `memberships` row while the on-chain `totalSignups` count stays unchanged would
widen a divergence that's already tracked as a live, visible bug. Zupoll's case is narrower (no
on-chain permanence issue) but still needs its own decision: leaving would orphan the member's
`zupollIdentityCommitments` row (no cascade — `memberships` has no FKs pointing at it, verified
during Child F's `/plan-eng-review` outside-voice pass) and raises a question this session
deliberately didn't answer — what happens to a proposal's already-cast-but-unrevealed zupoll vote
if the voter leaves mid-poll?

**Effort:** M (MACI case: depends on the member-count-divergence fix direction being chosen first;
zupoll case: S once the identity-commitment/vote-handling question is answered)
**Priority:** P2
**Depends on:** Member-count-divergence fix direction (MACI case); a design decision on
`zupollIdentityCommitments` cleanup and in-flight vote handling (zupoll case)

## ZuGov / Formalize communities follow-ups (from 2026-08-25 `/plan-eng-review`, Child H)

### Zupoll proposals and the generic proposal list disagree on visibility policy

**What:** `zupollService.listProposals()` is deliberately public (FR-012: "Zupoll proposals'
existence/question/options are visible to everyone, including non-members") with its own comment
explicitly contrasting itself against `proposalService.listForViewer`, which is session-gated and
tier-filtered. But Zupoll-created rows live in the SAME `proposals` table (via
`createZupollProposal`) and `listForViewer`'s query has no filter on `decisionAdapterType` — a
Zupoll proposal is pulled into `listForViewer`'s results too and subjected to `canView`'s
creator/tier gating, contradicting its own "public to everyone" design intent. Two live,
differently-gated "list this community's proposals" code paths can disagree about whether the
same row is visible, depending purely on which endpoint the caller hits.

**Why:** Found during Child H's `/plan-eng-review` outside-voice pass while verifying
`listForViewer`'s current gating. Pre-existing (true before Child H, which doesn't touch
`zupollService.ts` at all) — not introduced or worsened by Child H specifically, but real and
worth fixing on its own.

**Effort:** S–M (either filter `listForViewer`'s query to exclude zupoll-type proposals, since
they have their own dedicated public listing endpoint, or make `canView` aware of
`decisionAdapterType` and skip tier-gating for zupoll rows)
**Priority:** P3
**Depends on:** None

## ZuGov / Formalize communities follow-ups (from 2026-08-26 `/ship` coverage audit, Child J)

### DiscussionRow's delete action has no test for its non-401 error display or 401 sign-out branch

**What:** `DiscussionsSection.tsx`'s `DiscussionRow` wraps its delete call in the same
`withAuthDetect(...).catch` pattern `JoinSection.tsx` already has full test coverage for (error
display on a generic failure, `signOut()` called on a 401), but `DiscussionsSection.test.tsx`
only tests the success path. The identical pattern is proven correct elsewhere in the codebase,
so this is a coverage gap, not a suspected bug.

**Why:** Flagged by the coverage audit during `/ship` for the formalize-communities epic. Deferred
rather than fixed inline to avoid further expanding an already-large ship diff.

**Effort:** S (mirror `JoinSection.test.tsx`'s two equivalent tests)
**Priority:** P3
**Depends on:** None

### AwaitingActions.test.tsx's list() mock doesn't assert call arguments

**What:** Child E's `AwaitingActions.tsx` fix changed which positional argument carries the
authorized-wallet filter (`communityApi.list(..., address)`), but the existing test file's
`listMock` doesn't assert what arguments `list()` was actually called with — only that it
resolves. A future regression reordering or dropping that argument would not be caught.

**Why:** Flagged by the coverage audit during `/ship`. The underlying fix is correct and covered
end-to-end elsewhere (`communities.test.ts`'s `authorizedFor` describe block exercises the real
backend behavior), but this specific frontend call site's argument-passing isn't independently
verified.

**Effort:** S (add `expect(listMock).toHaveBeenCalledWith(...)` to the existing test)
**Priority:** P3
**Depends on:** None

### Proposal "unrestricted" visibility silently regresses when a community gains a new voting tier

**What:** `canView()`'s non-member branch treats a proposal as unrestricted only when its
`eligibleTierIds` (a snapshot frozen at creation time) is a superset of the community's
_currently_ voting-capable tiers (computed live). If an admin adds a new `canVote:true` tier
after a proposal already exists, the live check gains an ID the frozen snapshot doesn't have —
the superset check flips false, and a previously-public proposal silently becomes invisible to
anonymous/non-member viewers and to holders of the new tier. Unlike `events`/`communityDiscussions`
(this same epic gave both an explicit nullable `eligibleTierIds` column, where `NULL` means
unrestricted and is immune to tier-set drift), proposals still _infer_ "unrestricted" heuristically.

**Why:** Flagged by the `/ship` adversarial review. This bug predates this session (it already
existed for signed-in non-members before Child H), but Child H's own `requireAuth` removal from
the GET routes widened its reach from "signed-in non-members" to "fully anonymous traffic" —
this is a fail-CLOSED bug (over-hides, doesn't leak anything), so not a security bypass, but a
real, self-triggering visibility regression from an ordinary admin action.

**Effort:** M–L (real architecture decision: likely means giving `proposals.eligibleTierIds` the
same nullable/explicit-unrestricted treatment `events`/`communityDiscussions` already got, which
touches every proposal-creation path currently populating it with `getVotingTierIds()` as an
implicit default)
**Priority:** P2 (elevated from a typical P3 given the now-anonymous-reachable blast radius)
**Depends on:** None

### deleteTier() doesn't check event/discussion eligibleTierIds references before allowing deletion

**What:** `membershipService.ts`'s `deleteTier()` blocks deletion when a tier has members, is the
default tier, or is targeted by an eligibility rule — but never checks the two new
`events.eligibleTierIds`/`communityDiscussions.eligibleTierIds` JSON-string columns this same epic
added. Deleting a tier currently used to restrict an event or discussion succeeds silently; that
item's restriction becomes permanently unsatisfiable (no member can ever hold that tier ID again)
— invisible to everyone except its creator/author and admins, forever, with no warning to the
admin who deleted the tier.

**Why:** Flagged by the `/ship` adversarial review. A real integrity gap introduced by this diff
(the two referencing columns are brand new) — `deleteTier()` predates them and was never updated.
Fail-CLOSED (narrows visibility further, doesn't expose anything), so not a security bypass.

**Effort:** M (mirror the existing `eligibilityRules`-targeting check's shape: fetch the
community's events/discussions, deserialize `eligibleTierIds` via the shared
`membershipService.deserializeEligibleTierIds` helper, check `.includes(tierId)`, throw
`TierInUseError` if any match — query the schema tables directly to avoid a circular import with
`eventService.ts`/`discussionService.ts`)
**Priority:** P2
**Depends on:** None

### No server-side validation that eligibleTierIds reference real tiers of the same community (events/discussions)

**What:** Proposals validate `eligibleTierIds` against the community's real tiers at creation time
(`validateTierAndAxis`, filtering `invalidTierIds`) — `eventService.create/update` and
`discussionService.create/update` accept and store arbitrary tier-id strings unchecked.

**Why:** Flagged by the `/ship` adversarial review. Low severity — a caller can only lock their
own content out of view (self-inflicted), not gain access to anything — but it's an inconsistency
with the validation pattern this same epic already established for proposals, and a stale client
(tier deleted between fetch and submit) produces the same permanently-orphaned-restriction effect
as the `deleteTier()` gap above.

**Effort:** S (mirror `validateTierAndAxis`'s tier-existence check in both services)
**Priority:** P3
**Depends on:** None

### Admin bypass missing from proposalService's canView() (present on events/discussions)

**What:** `membershipService.canViewRestricted()` (events/discussions) explicitly grants a view
bypass for `ctx.isAdmin` — documented as necessary because a community's on-chain-reconciled owner
can hold real admin authority with no `memberships` row (the exact scenario this session's own
`/ship` review fixed for `DiscussionsSection.tsx`). `proposalService.canView()` has no equivalent
bypass: only proposal-creator-or-tier-membership. The same reconciled-owner actor the other two
resources deliberately protect cannot view a tier-restricted proposal they didn't personally
author.

**Why:** Flagged by the `/ship` adversarial review. Under-permissions (fails closed), not a
security bypass — a functional gap for an actor class this same epic carefully handled twice
elsewhere, that looks like an oversight rather than an intentional asymmetry.

**Effort:** S (add the same `isAuthorized()`-bypass branch `canViewRestricted` already has)
**Priority:** P3
**Depends on:** None

### Leave-community button gates on the wrong signal for zupoll-only communities

**What:** `JoinSection.tsx` only renders "Leave community" when `!contractAddress` (no MACI
contract deployed). The backend's `leave()` guard actually checks `communityDecisionAdapters`
attachment count, specifically because — per that code's own comment — zupoll attaches with zero
dependency on `maciGovernanceConfigs`/`contractAddress`. Net effect: a community with zupoll
attached but no MACI contract deployed still shows the Leave link, and clicking it always 409s
with `CommunityHasGovernanceError` — a guaranteed-to-fail affordance for exactly the case the
backend comment calls out as the reason the two checks diverge.

**Why:** Flagged by the `/ship` adversarial review. UX bug, not a security issue — the backend
correctly blocks the leave regardless, this only affects whether the button should have been
shown at all.

**Effort:** S (gate `JoinSection.tsx`'s Leave visibility on the same "any decision adapter
attached" signal the backend uses, e.g. via a lightweight community-governance-status prop/query,
instead of `contractAddress` alone)
**Priority:** P3
**Depends on:** None

### proposalService.listForViewer() has an unhoisted N+1 pattern in canView()

**What:** `listForViewer()` loops over every proposal row and calls `canView()` per row, which
(for a non-member/anonymous caller) re-runs `getVotingTierIds(communityId)` — a query whose result
is identical across every iteration for a fixed `communityId`. `eventService.list()` and
`discussionService.listForViewer()` both hoist this exact kind of loop-invariant lookup via
`resolveViewerContext()` (once per list() call, not once per row); `proposalService.ts`'s older
`canView()` predates that pattern and was never retrofitted.

**Why:** Flagged by the `/ship` review army's performance specialist. Pre-existing shape from
Child H (not newly introduced or worsened by Child I/J's work), but real debt now that the
pattern for fixing it exists twice elsewhere in the same codebase.

**Effort:** S–M (hoist `getVotingTierIds`/`getMemberTier` once before the loop, mirroring
`resolveViewerContext`'s shape; also replace the per-row `getSponsorCount()` query with one
grouped query)
**Priority:** P3
**Depends on:** None

### routes/discussions.ts's GET routes double-query membership status

**What:** `GET /:id/discussions` and `GET /:id/discussions/:discussionId` each call
`discussionService.isMemberOrAdmin()` (2 queries: `getMemberTier` + `isAuthorized`) immediately
before the service's own `resolveViewerContext()` runs the same 2 queries again — 4 round trips
doing overlapping work where 2 would do.

**Why:** Flagged by the `/ship` review army's performance specialist. Correctness is fine (D5's
gate and D1/D2's visibility filtering are both independently correct), this is a pure efficiency
cleanup.

**Effort:** S (resolve `resolveViewerContext()` once at the route layer, derive both the
access-gate boolean and pass the resolved context into the service functions instead of two
independent resolution paths)
**Priority:** P4
**Depends on:** None

### `ilike()` on creatorAddress/authorizedFor filters accepts unescaped wildcard characters

**What:** `communityService.ts`'s `list()` (creatorAddress, authorizedFor filters) passes raw
user-supplied wallet-address strings directly into drizzle's `ilike()` with no `%`/`_` escaping —
a crafted query param like `authorizedFor=%` would broaden the match beyond an exact address.

**Why:** Flagged by the `/ship` review army's security specialist. Confirmed low real-world impact
(community list data is already fully public via the unfiltered endpoint, and every actual
authorization decision — settings edits, child-community creation — re-verifies server-side
against the real session address independent of this filter) — this is a filter-correctness gap,
not a privilege escalation. Deferred rather than fixed inline given confirmed low severity.

**Effort:** S (validate the param matches a `0x`-prefixed hex address shape before passing to
`ilike()`, or escape `%`/`_` before interpolating)
**Priority:** P3
**Depends on:** None

### Tier-restriction toggle state/logic duplicated between CreateEventModal.tsx and CreateDiscussionModal.tsx

**What:** Only the presentational JSX was extracted into `TierRestrictionPicker.tsx` (Child J);
the surrounding state (`isRestricted`, `selectedTierIds`, `toggleTier`, the reset/prefill
`useEffect`, `hasValidTierSelection`) is still hand-duplicated in both modals.

**Why:** Flagged by the `/ship` review army's maintainability specialist. A real DRY gap, but
extracting the state logic into a shared hook (e.g. `useTierRestriction(initialEligibleTierIds)`)
is a larger, more judgment-heavy refactor than the mechanical JSX extraction already done —
deferred to avoid expanding this ship's diff further.

**Effort:** M (design and extract a shared hook, migrate both call sites, re-verify both test
files still pass unchanged)
**Priority:** P4
**Depends on:** None

### eligibleTierIdsSchema is copy-pasted between routes/events.ts and routes/discussions.ts

**What:** The exact same `z.array(z.string()).min(1).nullable().optional()` Zod schema (with the
same explanatory comment) appears verbatim in both route files.

**Why:** Flagged by the `/ship` review army's maintainability specialist. Small, low-risk
extraction candidate (e.g. into a shared `validators/tierRestriction.ts`) — deferred only because
this ship's diff is already large.

**Effort:** XS (move to a shared file, both routers import it)
**Priority:** P4
**Depends on:** None

### DELETE /discussions/:id returns {success: true}, inconsistent with the rest of the API's {ok: true} convention

**What:** Every other no-payload mutation response in this codebase (`auth.ts`, `membership.ts`'s
Leave, `venues.ts`) returns `{ok: true}`; the new discussions DELETE route returns
`{success: true}` instead.

**Why:** Flagged by the `/ship` review army's api-contract specialist. Not breaking today
(`discussionApi.ts`'s `deleteDiscussion()` was written to match `{success: true}`), but a
footgun for whichever file the next endpoint's author copies from.

**Effort:** XS (change the route's response body to `{ok: true}`; `deleteDiscussion()` in
`discussionApi.ts` doesn't inspect the body at all, so no frontend change needed)
**Priority:** P4
**Depends on:** None

### manage-communities/page.tsx has no test file at all

**What:** Child E's `authorizedFor` fix touches `manage-communities/page.tsx` (passing `address`
as the 5th argument to `communityApi.list()`), but this file has zero test coverage of any kind —
not just for this specific fix, pre-existing.

**Why:** Flagged by the coverage audit during `/ship`. Out of scope to backfill a full test file
for a page this epic only touched with a one-line argument fix; tracked separately so it doesn't
get lost.

**Effort:** M (new test file, needs its own wagmi/router mocking scaffolding like `page.test.tsx`)
**Priority:** P3
**Depends on:** None

### Per-poll message-count/eligibility fetch is an N+1-shaped RPC pattern

**What:** `page.tsx:108-128`'s two `useQuery` hooks each fire one on-chain read per poll
(`fetchNumMessages`, `fetchIsEligible`), parallelized via `Promise.all` but still scaling
linearly with poll count — a community with 50 polls fires 100 RPC calls on page load. The
community-page redesign (`/plan-eng-review`, 2026-08-26) relocates this code unchanged into the
new `OverviewTab` component; it was flagged during that review's Performance section but
explicitly not fixed there, since it's orthogonal to the routing/tabs work.

**Why:** Real, verified performance pattern — not speculative. Parallelized so it's not as bad as
a sequential N+1, but still an unbounded-with-poll-count RPC fan-out on every single Overview-tab
load. Fixing it properly means either a batched multicall (single RPC call reading all polls'
message counts/eligibility in one round trip) or a backend-side aggregation endpoint — either is
a real architecture decision on its own, not a one-line patch, so it was deliberately kept out of
the redesign's diff rather than conflating two unrelated changes.

**Effort:** M (multicall batching requires picking a multicall pattern/library and reworking
`readContract.ts`'s call sites; a backend aggregation endpoint requires a new route plus a
subgraph or RPC-batching implementation server-side — either way, needs its own scoping pass)
**Priority:** P3
**Depends on:** None

## ZuGov / Unions-as-communities follow-ups (from 2026-08-28 `/plan-eng-review`)

### Union governance/decision-making

**What:** Attach a real decision adapter (MACI or zupoll) to union-type communities so their
proposals can actually be voted on, not just created and discussed.

**Why:** Explicitly deferred during the union-as-community merge (2026-08-28 `/plan-eng-review`)
— the founder flagged it as "tricky" and wanted it scoped separately from the entity-merge work
itself. After that merge, a union-type community has full Overview/Events/Proposals/Discussions/
Settings, but a created proposal has no attached decision adapter — same starting state as any
brand-new regular community (`NoDecisionAdapterAttachedError`'s existing behavior).

**Pros:** Completes the "union is also a community" model for its last major piece — governance
is the one capability regular communities have that unions still won't have after that merge
lands.

**Cons:** Real complexity, not a thin wiring job. Needs its own design pass on what "a union
votes on something" even means before any adapter-attachment work starts: do only member
communities' admins get a vote? One vote per member community, or weighted by something (member
count, tier, stake)? MACI's existing per-wallet voter model doesn't map cleanly onto
"communities are the voters," so this may need real changes to the decision-adapter layer
itself, not just a config toggle.

**Context:** The union-as-community merge locked an explicit guard (`attachGovernance()` rejects
`type === 'union'` targets) precisely so this stays a deliberate, designed decision later rather
than something that silently works today in a half-broken way.

**Depends on:** The union-as-community merge (2026-08-28) landing first.

**Effort:** L (needs its own product/architecture design pass before implementation sizing is
even possible — the voter-model question above is the crux of it)
**Priority:** P2

## Event detail page follow-ups (from 2026-08-28 `/office-hours` + `/plan-eng-review`)

### Side-event eligibility doesn't re-propagate from its parent

**What:** `Event.eligibleTierIds` is copied at creation time only (`eventService.ts`'s `create()`)
and never re-checked or cascaded when a parent event's own eligibility changes afterward.

**Why:** Found while designing the event detail page's "Part of: {parent}" link (side-event →
parent) — a viewer could see a side-event whose parent has since become invisible to them, since
the side-event's own snapshot never updates. A real, if rare, data-integrity gap in the tier-gating
model, not something this feature caused.

**Context:** The event detail page (see the design doc and eng review from 2026-08-28) works
around this by simply omitting the parent link if the parent fetch 404s for the viewer — it does
not fix the underlying drift. A real fix means either re-checking the parent's current eligibility
at read time (an extra query per side-event view) or cascading eligibility changes from a parent
to its side-events on update (more invasive, touches `eventService.ts`'s `update()`).

**Effort:** M (the read-time re-check is the cheaper option; the cascade-on-update option is
larger and touches event-update semantics more broadly)
**Priority:** P3
**Depends on:** None

### Full sola.day parity on the event detail page

**What:** Map/venue embed, host profile, a related/side-events section beyond the simple parent/
child links, and social share preview cards (Open Graph tags).

**Why:** Explicitly named as the deferred scope in the 2026-08-28 `/office-hours` design doc's
narrowest-wedge decision — the shipped v1 wedge is "a real URL + full details + who's going," not
full parity with the sola.day reference the founder pointed at.

**Context:** These are several genuinely separate features bundled under one name, not one unit of
work — OG tags alone likely need SSR/meta-tag infrastructure this SPA may not currently have,
which would need its own scoping pass before sizing. Revisit once real usage at Zukas 2026 (Sept
9-20, 2026) shows which of these (if any) people actually want, rather than building speculatively.

**Effort:** L (multiple distinct sub-features, at least one — OG tags — likely needs new
infrastructure this app doesn't have yet)
**Priority:** P3
**Depends on:** Event detail page (2026-08-28) landing first; real usage data from Zukas 2026

### Edit/cancel/duplicate management actions on the event detail page

**What:** Let a creator/admin edit, cancel, or duplicate an event directly from its own detail
page, not just from the community's events list.

**Why:** The 2026-08-28 eng review deliberately scoped the detail page to read-only + RSVP for v1
— `EventRow`'s RSVP/menu hook extraction only covers state (RSVP mutation, menu open/close), not
the ~110 lines of menu/`DuplicateForm` JSX or the `CreateEventModal`/`editingEvent` wiring, which
lives in `EventsSection` (the parent), not `EventRow` itself. Building management actions on the
detail page today would mean duplicating that JSX a second time.

**Context:** Real friction for a creator/admin who lands on their own event's shared link and
wants to manage it in place, but the underlying components aren't currently structured for reuse
across both surfaces. Whoever picks this up needs to either accept the JSX duplication or finally
do the fuller shared-component extraction (Approach B from the design doc) that this session
explicitly deferred as premature for the read-only wedge.

**Effort:** M (JSX duplication route) to L (proper shared-component extraction route) — sizing
depends on which path is chosen when this is picked up
**Priority:** P3
**Depends on:** Event detail page (2026-08-28) landing first

## E0 credential wedge follow-ups (from 2026-08-29 `/office-hours` + `/plan-eng-review`)

### Register ZuGov's own Zupass Generic Issuance pipeline

**What:** Register a real Zupass Generic Issuance pipeline for ZuGov/Zukas 2026, populated with
real Zukas ticket/credential data — replacing `ZUPASS_TICKET_CONFIG = ETHBERLIN04` (a bundled
sample event with zero relation to Zukas), currently hardcoded identically in both
`apps/zugov-backend/src/services/identity/zupassAdapter.ts` and
`apps/zugov-frontend/src/hooks/useCredentialScan.ts`.

**Why:** This is the actual gating dependency for the credential wedge (E0) to do anything correct
at Zukas 2026 — not the engineering work, which is fast and low-risk by comparison. Until this
pipeline is live, the verify flow has exactly two possible outcomes: fail for every real attendee
(if left on), or pass for anyone holding an unrelated old ETHBerlin04 PCD. There is no third,
correct outcome. Surfaced by the outside-voice review during E0's `/plan-eng-review` — previously
buried in matching code comments on both files, never tracked as an action item.

**Context:** E0 ships with the credential requirement OFF by default on every tier specifically
because of this — activating it for a real Zukas tier is a separate, explicit decision gated on
this pipeline actually being registered, not assumed to land alongside the code.

**Effort:** Unknown — external coordination with Zupass/Personhood Foundation, not an engineering
estimate.
**Priority:** P0 (blocks E0 ever being safely activated for the live Zukas 2026 pilot, Sept 9-20)
**Depends on:** None (external, should start immediately, independent of E0's code landing)

### Verify the backend Zupass credential-verify path against a real proof

**What:** `credentialStore`/`zupassAdapter.ts`'s backend verify path has never been confirmed
against a real Zupass proof — `tests/credentials.test.ts`'s 8 passing tests mock `openac-sdk` (the
**zkID** library) entirely, not Zupass's own verification path. The assumption that "Zupass already
works" rests on adjacent green tests, not a direct check of this specific path.

**Why:** Surfaced by the outside-voice review during E0's `/plan-eng-review`. `zkidAdapter.ts`
calls the same `openac-sdk@0.3.0` package/version as the frontend's confirmed-broken zkID path
(`OpenAC.init()` throws `WasmError` at runtime) — a real, verified problem for zkID specifically.
Zupass uses a different library (`@pcd/zuauth`), so this isn't necessarily broken the same way, but
nobody has actually exercised it against a real proof to confirm that.

**Context:** Should happen before E0's credential requirement is ever activated on a real tier, not
as a blocker to writing E0's code — matches the "ship OFF by default" decision's intent of
decoupling "is the code correct" from "is the external verification path actually trustworthy."

**Effort:** S — needs one real Zupass credential/PCD to test against, not new code.
**Priority:** P1
**Depends on:** None
