import { useState, useCallback } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { signup } from "@znurznurznur/extended-maci-sdk/browser";
import { useMaci } from "../context/MaciContext";
import { GovernanceTypes, type GovernanceType } from "../config";
import { getSignerFromWalletClient } from "../services/wagmiSigner";

interface UseSignupResult {
  isSigningUp: boolean;
  signupError: string | null;
  signupToMaci: (maciAddress: string) => Promise<void>;
}

export function useSignup(governanceType: GovernanceType | undefined): UseSignupResult {
  const { isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { maciKeypair } = useMaci();
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);

  const signupToMaci = useCallback(
    async (maciAddress: string) => {
      if (!isConnected) throw new Error("Wallet not connected");
      if (!maciKeypair) throw new Error("MACI keypair not available");
      if (!governanceType || governanceType !== GovernanceTypes.MACI) {
        throw new Error(`Signup not supported for governance type "${governanceType}"`);
      }

      setIsSigningUp(true);
      setSignupError(null);

      try {
        const signer = getSignerFromWalletClient(walletClient);
        await signup({
          maciPublicKey: maciKeypair.publicKey.serialize(),
          maciAddress,
          sgData: "0x",
          signer,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSignupError(message);
        throw err;
      } finally {
        setIsSigningUp(false);
      }
    },
    [isConnected, maciKeypair, governanceType, walletClient],
  );

  return { isSigningUp, signupError, signupToMaci };
}
