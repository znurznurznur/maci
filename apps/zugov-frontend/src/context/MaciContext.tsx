import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { keccak256, type Hex } from "viem";
import { Keypair, PrivateKey } from "@extended-maci/domainobjs";
import { SIGNATURE_MESSAGE } from "../constants";

interface MaciContextValue {
  maciKeypair: Keypair | null;
  isSigning: boolean;
  generateKeypair: () => Promise<Keypair | null>;
}

const MaciContext = createContext<MaciContextValue>({
  maciKeypair: null,
  isSigning: false,
  generateKeypair: async () => null,
});

function generateKeypairFromSeed(seed: Hex): Keypair {
  return new Keypair(new PrivateKey(BigInt(seed)));
}

const storageKey = (address: string) => `maci_keypair_${address}`;

export function MaciProvider({ children }: { children: ReactNode }) {
  const { isConnected, address } = useAccount();
  const [maciKeypair, setMaciKeypair] = useState<Keypair | null>(null);
  const { signMessageAsync, isPending: isSigning } = useSignMessage();

  const saveKeypairToLocalStorage = useCallback(
    (keypair: Keypair) => {
      if (!address) return;
      localStorage.setItem(storageKey(address), keypair.privateKey.serialize());
    },
    [address],
  );

  const generateKeypair = useCallback(async () => {
    if (!address) return null;

    try {
      const signature = await signMessageAsync({ message: SIGNATURE_MESSAGE });
      const seed = keccak256(signature);
      const userKeyPair = generateKeypairFromSeed(seed);

      saveKeypairToLocalStorage(userKeyPair);
      setMaciKeypair(userKeyPair);

      return userKeyPair;
    } catch (err) {
      console.error("Error generating keypair:", err);
      return null;
    }
  }, [address, signMessageAsync, saveKeypairToLocalStorage]);

  useEffect(() => {
    if (!isConnected || !address) {
      setMaciKeypair(null);
      return;
    }

    const stored = localStorage.getItem(storageKey(address));
    if (stored) {
      setMaciKeypair(new Keypair(PrivateKey.deserialize(stored)));
      return;
    }

    generateKeypair();
  }, [isConnected, address]); // eslint-disable-line react-hooks/exhaustive-deps

  return <MaciContext.Provider value={{ maciKeypair, isSigning, generateKeypair }}>{children}</MaciContext.Provider>;
}

export const useMaci = () => useContext(MaciContext);
