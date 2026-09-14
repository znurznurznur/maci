import { useState, useCallback } from "react";
import { useAccount, useWalletClient } from "wagmi";
import type { BrowserProvider } from "ethers";
import { getSignerFromWalletClient } from "../services/wagmiSigner";
import { joinPoll } from "@znurznurznur/extended-maci-sdk/browser";
import { Poll__factory } from "../poll-factory-shim";
import { useMaci } from "../context/MaciContext";
import { GovernanceTypes, type GovernanceType } from "../config";
import { fetchStartBlock } from "../services/subgraph";

const POLL_JOIN_STORAGE_KEY = (pollAddress: string, walletAddress: string) =>
  `pollStateIndex_${pollAddress.toLowerCase()}_${walletAddress.toLowerCase()}`;

function isEthGetLogsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("Block range is too large") || msg.includes("eth_getLogs");
}

/**
 * Fallback: the tx went through but reading the PollJoined event failed.
 * Query the Poll contract for the event using the known block number.
 */
async function getPollJoinedDataFromReceipt(
  pollAddress: string,
  pubKeyX: bigint,
  pubKeyY: bigint,
  blockNumber: number,
  signer: Awaited<ReturnType<BrowserProvider["getSigner"]>>,
): Promise<{ pollStateIndex: string; voiceCredits: string } | null> {
  const pollContract = Poll__factory.connect(pollAddress, signer);
  const events = await pollContract.queryFilter(
    pollContract.filters.PollJoined(pubKeyX, pubKeyY),
    blockNumber,
    blockNumber,
  );
  const event = events[0];
  if (!event) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args = (event as any).args;
  return {
    pollStateIndex: args._pollStateIndex.toString(),
    voiceCredits: args._voiceCreditBalance.toString(),
  };
}

export interface JoinPollResult {
  pollStateIndex: string;
  voiceCredits: string;
  nullifier: string;
  hash: string;
}

export function useJoinPoll(governanceType: GovernanceType | undefined) {
  console.log("useJoinPoll", governanceType);
  const { isConnected, address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { maciKeypair } = useMaci();
  console.log("useJoinPoll", isConnected, address, maciKeypair);
  const [joiningPollId, setJoiningPollId] = useState<string | null>(null);
  const [joinPollError, setJoinPollError] = useState<string | null>(null);

  const joinThePoll = useCallback(
    async ({
      maciAddress,
      pollId,
      pollAddress,
      pollJoiningZkeyUrl,
      pollJoiningWasmUrl,
      subgraphUrl,
    }: {
      maciAddress: string;
      pollId: bigint;
      pollAddress: string;
      pollJoiningZkeyUrl: string;
      pollJoiningWasmUrl: string;
      subgraphUrl: string;
    }): Promise<JoinPollResult> => {
      console.log("joinThePoll", maciAddress, pollId, pollAddress, pollJoiningZkeyUrl, pollJoiningWasmUrl);
      if (!isConnected) throw new Error("Wallet not connected");
      if (!maciKeypair) throw new Error("MACI keypair not available");
      if (!address) throw new Error("No wallet address");
      if (governanceType !== GovernanceTypes.MACI) {
        throw new Error(`Join poll not supported for governance type "${governanceType}"`);
      }

      setJoiningPollId(pollAddress);
      setJoinPollError(null);

      const signer = getSignerFromWalletClient(walletClient);

      try {
        const startBlock = await fetchStartBlock(subgraphUrl, governanceType);
        console.log("joinPoll startBlock:", startBlock, maciAddress, pollId);
        const result = await joinPoll({
          maciAddress,
          privateKey: maciKeypair.privateKey.serialize(),
          pollId,
          signer,
          startBlock,
          pollJoiningZkey: pollJoiningZkeyUrl,
          pollJoiningWasm: pollJoiningWasmUrl,
          sgDataArg: "0x",
          ivcpDataArg: "0x",
          useLatestStateIndex: true,
          blocksPerBatch: 500,
        });

        localStorage.setItem(POLL_JOIN_STORAGE_KEY(pollAddress, address), result.pollStateIndex);
        return result;
      } catch (err) {
        // If the tx was sent but reading the PollJoined event failed due to block range,
        // attempt to recover by querying the event directly from the receipt block.
        if (isEthGetLogsError(err)) {
          try {
            const currentBlock = await signer.provider.getBlockNumber();
            const [pubKeyX, pubKeyY] = maciKeypair.publicKey.raw;
            const fallbackData = await getPollJoinedDataFromReceipt(
              pollAddress,
              pubKeyX,
              pubKeyY,
              currentBlock,
              signer,
            );

            if (fallbackData) {
              localStorage.setItem(POLL_JOIN_STORAGE_KEY(pollAddress, address), fallbackData.pollStateIndex);
              return { ...fallbackData, nullifier: "", hash: "" };
            }
          } catch {
            // fallback also failed — fall through to original error
          }
        }

        const message = err instanceof Error ? err.message : String(err);
        setJoinPollError(message);
        throw err;
      } finally {
        setJoiningPollId(null);
      }
    },
    [isConnected, maciKeypair, address, governanceType, walletClient],
  );

  const getPollStateIndex = useCallback(
    (pollAddress: string): string | null => {
      if (!address) return null;
      return localStorage.getItem(POLL_JOIN_STORAGE_KEY(pollAddress, address));
    },
    [address],
  );

  const isJoiningPoll = (pollAddress: string) => joiningPollId === pollAddress;

  return { isJoiningPoll, joinPollError, joinThePoll, getPollStateIndex };
}
