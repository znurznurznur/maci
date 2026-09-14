import type { Keypair } from "@extended-maci/domainobjs";
import { GovernanceTypes, type GovernanceType } from "../config";

/** Formats a MACI public key as the space-separated subgraph User ID used for signups. */
export function formatMaciUserId(keypair: Keypair): string {
  const [x, y] = keypair.publicKey.raw;
  return `${x} ${y}`;
}

const QUERIES = {
  GET_FIRST_SIGNUP_BLOCK: `
    query GetFirstSignupBlock {
      _meta { block { number timestamp } }
      accounts(first: 1, orderBy: createdAt, orderDirection: asc) {
        createdAt
      }
    }
  `,
  GET_IS_REGISTERED: `
    query GetIsRegistered($userId: ID!) {
      user(id: $userId) {
        accounts {
          id
        }
      }
    }
  `,
  GET_MEMBERS: `
    query GetMembers {
      macis(first: 1) {
        totalSignups
      }
    }
  `,
  GET_POLLS: `
    query GetPolls {
      polls(first: 100, orderBy: createdAt, orderDirection: desc) {
        id
        pollId
        name
        metadata
        startDate
        endDate
        voteOptions
        options
        mode
        policyType
        policy
      }
    }
  `,
  GET_IS_JOINED_POLL: `
    query GetIsJoinedPoll($registrationId: ID!) {
      registration(id: $registrationId) {
        id
      }
    }
  `,
  GET_HAS_VOTED: `
    query GetHasVoted($pollId: Bytes!, $publicKey: [BigInt!]!) {
      votes(where: { poll: $pollId, publicKey: $publicKey }, first: 1) {
        id
      }
    }
  `,
};

/** Numeric string matching the on-chain Mode enum: QV=0, NON_QV=1, FULL=2, RANKED=3 */
export type PollMode = "0" | "1" | "2" | "3";

export interface SubgraphPoll {
  id: string;
  pollId: string;
  name: string;
  metadata: string;
  startDate: string;
  endDate: string;
  voteOptions: string;
  options: string[] | null;
  mode: PollMode;
  policyType: string;
  policy: string;
}

async function querySubgraph<T>(url: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Subgraph request failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  console.log("[querySubgraph] raw response:", JSON.stringify(json));
  const { data, errors } = json as { data: T; errors?: { message: string }[] };

  if (errors?.length) {
    throw new Error(`Subgraph errors: ${errors.map((e) => e.message).join(", ")}`);
  }

  return data;
}

export async function fetchIsRegistered(url: string, governanceType: GovernanceType, userId: string): Promise<boolean> {
  if (governanceType === GovernanceTypes.MACI) {
    console.log("[fetchIsRegistered] subgraphUrl:", url, "userId:", userId);
    const data = await querySubgraph<{ user: { accounts: { id: string }[] } | null }>(url, QUERIES.GET_IS_REGISTERED, {
      userId,
    });
    console.log("[fetchIsRegistered] result:", JSON.stringify(data));
    return (data?.user?.accounts.length ?? 0) > 0;
  }

  throw new Error(`fetchIsRegistered: unsupported governance type "${governanceType}"`);
}

export async function fetchMembers(url: string, governanceType: GovernanceType): Promise<number> {
  if (governanceType === GovernanceTypes.MACI) {
    const data = await querySubgraph<{ macis: { totalSignups: string }[] }>(url, QUERIES.GET_MEMBERS);
    return Number(data.macis[0]?.totalSignups ?? 0);
  }

  throw new Error(`fetchMembers: unsupported governance type "${governanceType}"`);
}

export async function fetchPolls(url: string, governanceType: GovernanceType): Promise<SubgraphPoll[]> {
  if (governanceType === GovernanceTypes.MACI) {
    const data = await querySubgraph<{ polls: SubgraphPoll[] }>(url, QUERIES.GET_POLLS);
    return data.polls;
  }

  throw new Error(`fetchPolls: unsupported governance type "${governanceType}"`);
}

/**
 * Estimates the block number of the first signup by interpolating from the subgraph's
 * indexed head block and the earliest account's createdAt timestamp.
 * Returns a block 200 blocks before the estimated signup block as a safe lower bound.
 */
export async function fetchStartBlock(url: string, governanceType: GovernanceType): Promise<number> {
  if (governanceType !== GovernanceTypes.MACI) {
    throw new Error(`fetchStartBlock: unsupported governance type "${governanceType}"`);
  }

  const data = await querySubgraph<{
    _meta: { block: { number: number; timestamp: number } };
    accounts: { createdAt: string }[];
  }>(url, QUERIES.GET_FIRST_SIGNUP_BLOCK);

  const headBlock = data._meta.block.number;
  const headTimestamp = data._meta.block.timestamp;
  const firstSignupTimestamp = Number(data.accounts[0]?.createdAt ?? headTimestamp);

  // Scroll Sepolia ~3s block time
  const BLOCK_TIME_SECONDS = 3;
  const blocksAgo = Math.ceil((headTimestamp - firstSignupTimestamp) / BLOCK_TIME_SECONDS);
  const estimatedBlock = headBlock - blocksAgo;

  return Math.max(0, estimatedBlock - 200);
}

/**
 * Checks if a user has joined a specific poll.
 * Registration ID format: `${pollHexAddress}-${pubKeyX}-${pubKeyY}`
 */
export async function fetchIsJoinedPoll(
  url: string,
  governanceType: GovernanceType,
  pollId: string,
  pubKeyX: bigint,
  pubKeyY: bigint,
): Promise<boolean> {
  if (governanceType === GovernanceTypes.MACI) {
    const registrationId = `${pollId.toLowerCase()}-${pubKeyX}-${pubKeyY}`;
    const data = await querySubgraph<{ registration: { id: string } | null }>(url, QUERIES.GET_IS_JOINED_POLL, {
      registrationId,
    });
    return data.registration !== null;
  }

  throw new Error(`fetchIsJoinedPoll: unsupported governance type "${governanceType}"`);
}

/**
 * Checks whether a member has already voted on a poll, by looking for a `Vote` matching their
 * registered MACI public key — never reads `Vote.data` (the encrypted message), only existence,
 * so vote content stays opaque (Constitution Principle III).
 */
export async function fetchHasVoted(
  url: string,
  governanceType: GovernanceType,
  pollId: string,
  pubKeyX: bigint,
  pubKeyY: bigint,
): Promise<boolean> {
  if (governanceType === GovernanceTypes.MACI) {
    const data = await querySubgraph<{ votes: { id: string }[] }>(url, QUERIES.GET_HAS_VOTED, {
      pollId,
      publicKey: [pubKeyX.toString(), pubKeyY.toString()],
    });
    return data.votes.length > 0;
  }

  throw new Error(`fetchHasVoted: unsupported governance type "${governanceType}"`);
}
