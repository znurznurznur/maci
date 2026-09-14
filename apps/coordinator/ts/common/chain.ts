import { ESupportedChains } from "@znurznurznur/extended-maci-sdk";
import { type HDNodeWallet, type Signer, JsonRpcProvider, Wallet } from "ethers";

import { ErrorCodes } from "./errors";

/**
 * Look up the configured RPC url for a given chain, if any.
 *
 * Keep in sync with apps/zugov-frontend/src/config.ts's supportedChains — a chain added
 * there without an entry here fails closed below, the same way
 * apps/zugov-backend/src/services/chainRpc.ts's RPC_URLS does on the backend side.
 *
 * @param network - the network to look up
 * @returns the configured RPC url, or undefined if none is configured for this chain
 */
const getConfiguredRpcUrl = (network: ESupportedChains): string | undefined => {
  switch (network) {
    case ESupportedChains.Sepolia:
      return process.env.COORDINATOR_SEPOLIA_RPC_URL;
    case ESupportedChains.ScrollSepolia:
      return process.env.COORDINATOR_SCROLL_SEPOLIA_RPC_URL;
    // Local dev/test networks (hardhat.config.cjs's "localhost"/"hardhat") aren't real
    // deployed chains — they keep using the single COORDINATOR_RPC_URL, unaffected by the
    // per-chain vars above.
    case ESupportedChains.Localhost:
    case ESupportedChains.Hardhat:
      return process.env.COORDINATOR_RPC_URL;
    default:
      return undefined;
  }
};

/**
 * Get the RPC url for the chain we need to interact with
 *
 * @param network - the network we want to interact with
 * @returns the RPC url for the network
 */
export const getRpcUrl = async (network: ESupportedChains): Promise<string> => {
  if (!Object.values(ESupportedChains).includes(network)) {
    return Promise.reject(new Error(ErrorCodes.UNSUPPORTED_NETWORK.toString()));
  }

  const rpcUrl = getConfiguredRpcUrl(network);

  if (!rpcUrl) {
    // Include the chain so an unconfigured chain never gets silently routed to a different
    // chain's endpoint — see specs/009-coordinator-multi-chain-rpc/contracts/unconfigured-chain-error.md.
    return Promise.reject(new Error(`${ErrorCodes.COORDINATOR_RPC_URL_NOT_SET.toString()}: ${network}`));
  }

  return Promise.resolve(rpcUrl);
};

/**
 * Get wallet from private key or mnemonic env variable
 *
 * @returns wallet
 */
export const getWallet = (): Wallet | HDNodeWallet =>
  process.env.PRIVATE_KEY ? new Wallet(process.env.PRIVATE_KEY) : Wallet.fromPhrase(process.env.MNEMONIC!);

/**
 * Get a Ethers Signer given a chain and private key
 * @param chain
 * @returns
 */
export const getSigner = async (chain: ESupportedChains): Promise<Signer> => {
  const wallet = getWallet();

  const alchemyRpcUrl = await getRpcUrl(chain);
  const provider = new JsonRpcProvider(alchemyRpcUrl);

  return wallet.connect(provider);
};
