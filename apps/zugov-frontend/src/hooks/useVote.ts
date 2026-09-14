import { useState, useCallback } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { JsonRpcProvider } from "ethers";
import { generateVote, submitVote, getCoordinatorPublicKey } from "@znurznurznur/extended-maci-sdk/browser";
import { useMaci } from "../context/MaciContext";
import { GovernanceTypes, type GovernanceType } from "../config";
import { MACI__factory } from "../poll-factory-shim";
import { getSignerFromWalletClient } from "../services/wagmiSigner";

export function useVote(governanceType: GovernanceType | undefined) {
  const { isConnected, address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { maciKeypair } = useMaci();
  const [isVoting, setIsVoting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  const castVote = useCallback(
    async ({
      pollAddress,
      pollId,
      maciAddress,
      rpcUrl,
      voteOptionIndex,
      voteWeight,
      maxVoteOption,
      nonce = 1n,
      isRanked = false,
    }: {
      pollAddress: string;
      pollId: bigint;
      maciAddress: string;
      rpcUrl: string;
      voteOptionIndex: bigint;
      voteWeight: bigint;
      maxVoteOption: bigint;
      nonce?: bigint;
      isRanked?: boolean;
    }) => {
      if (!isConnected) throw new Error("Wallet not connected");
      if (!maciKeypair) throw new Error("MACI keypair not available");
      if (!address) throw new Error("No wallet address");
      if (governanceType !== GovernanceTypes.MACI) {
        throw new Error(`Voting not supported for governance type "${governanceType}"`);
      }

      setIsVoting(true);
      setVoteError(null);

      try {
        const signer = getSignerFromWalletClient(walletClient);

        // Fetch the MACI state index (1-based) for this user's public key
        const readProvider = new JsonRpcProvider(rpcUrl);
        const maciContract = MACI__factory.connect(maciAddress, readProvider);
        const stateIndex = await maciContract.getStateIndex(maciKeypair.publicKey.hash());

        if (stateIndex < 1n) {
          throw new Error("You are not registered in MACI. Please register before voting.");
        }

        const coordinatorPublicKey = await getCoordinatorPublicKey(pollAddress, signer);

        const vote = generateVote({
          pollId,
          voteOptionIndex,
          nonce,
          isRanked,
          privateKey: maciKeypair.privateKey,
          stateIndex,
          voteWeight,
          coordinatorPublicKey,
          maxVoteOption,
        });

        return await submitVote({ pollAddress, vote, signer });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setVoteError(message);
        throw err;
      } finally {
        setIsVoting(false);
      }
    },
    [isConnected, maciKeypair, address, governanceType, walletClient],
  );

  return { isVoting, voteError, castVote };
}
