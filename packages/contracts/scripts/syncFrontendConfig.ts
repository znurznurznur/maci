import fs from "fs";
import path from "path";

import { ContractStorage } from "../tasks/helpers/ContractStorage";
import { ECheckerFactories, ECheckers, EContracts, EPolicyFactories } from "../tasks/helpers/types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const CONTRACTS_DIR = path.resolve(__dirname, "..");
const FRONTEND_GENERATED_DIR = path.resolve(CONTRACTS_DIR, "../../apps/zugov-frontend/src/generated");

/**
 * Maps a frontend `PolicyFactories` key to the factory contracts registered during deployment.
 */
const POLICY_MAPPINGS: {
  frontendKey: string;
  policyFactory: EPolicyFactories;
  checkerFactory: ECheckerFactories;
}[] = [
  {
    frontendKey: "freeForAll",
    policyFactory: EPolicyFactories.FreeForAll,
    checkerFactory: ECheckerFactories.FreeForAll,
  },
  { frontendKey: "eas", policyFactory: EPolicyFactories.EAS, checkerFactory: ECheckerFactories.EAS },
  { frontendKey: "zupass", policyFactory: EPolicyFactories.Zupass, checkerFactory: ECheckerFactories.Zupass },
  {
    frontendKey: "gitcoinPassport",
    policyFactory: EPolicyFactories.GitcoinPassport,
    checkerFactory: ECheckerFactories.GitcoinPassport,
  },
  { frontendKey: "semaphore", policyFactory: EPolicyFactories.Semaphore, checkerFactory: ECheckerFactories.Semaphore },
  {
    frontendKey: "anonAadhaar",
    policyFactory: EPolicyFactories.AnonAadhaar,
    checkerFactory: ECheckerFactories.AnonAadhaar,
  },
  { frontendKey: "erc20Token", policyFactory: EPolicyFactories.ERC20, checkerFactory: ECheckerFactories.ERC20 },
  {
    frontendKey: "erc20Votes",
    policyFactory: EPolicyFactories.ERC20Votes,
    checkerFactory: ECheckerFactories.ERC20Votes,
  },
  { frontendKey: "token", policyFactory: EPolicyFactories.Token, checkerFactory: ECheckerFactories.Token },
  {
    frontendKey: "merkleProof",
    policyFactory: EPolicyFactories.MerkleProof,
    checkerFactory: ECheckerFactories.MerkleProof,
  },
  { frontendKey: "hatsProtocol", policyFactory: EPolicyFactories.Hats, checkerFactory: ECheckerFactories.Hats },
];

/**
 * Maps a frontend `PolicyInfrastructure` field to the external protocol address configured
 * in deploy-config.json for that policy (present regardless of whether "deploy" is true).
 */
const INFRASTRUCTURE_FIELDS: { field: string; contract: EContracts; configKey: string }[] = [
  { field: "easAddress", contract: EContracts.EASPolicy, configKey: "easAddress" },
  { field: "zupassVerifier", contract: EContracts.ZupassPolicy, configKey: "zupassVerifier" },
  { field: "gitcoinDecoder", contract: EContracts.GitcoinPassportPolicy, configKey: "decoderAddress" },
  { field: "semaphoreAddress", contract: EContracts.SemaphorePolicy, configKey: "semaphoreContract" },
  { field: "hatsAddress", contract: EContracts.HatsPolicy, configKey: "hatsProtocolAddress" },
];

const getNetworkArg = (): string => {
  const flagIndex = process.argv.indexOf("--network");
  const network = flagIndex !== -1 ? process.argv[flagIndex + 1] : undefined;

  if (!network) {
    throw new Error("Usage: sync-frontend-config -- --network <network>");
  }

  return network;
};

const isHexAddress = (value: unknown): value is string => typeof value === "string" && value.startsWith("0x");

function main(): void {
  const network = getNetworkArg();
  const storage = ContractStorage.getInstance(path.resolve(CONTRACTS_DIR, "deployed-contracts.json"));
  const deployConfig = JSON.parse(fs.readFileSync(path.resolve(CONTRACTS_DIR, "deploy-config.json"), "utf8")) as Record<
    string,
    Record<string, Record<string, unknown>>
  >;
  const networkConfig = deployConfig[network] ?? {};

  const registryAddress = storage.getAddress(EContracts.ZuGovRegistry, network) ?? ZERO_ADDRESS;
  const constantVoiceCreditProxyFactory =
    storage.getAddress(EContracts.ConstantInitialVoiceCreditProxyFactory, network) ?? ZERO_ADDRESS;
  // The stateless FreeForAllChecker *instance* (reused across all polls) — distinct from
  // policyFactories.freeForAll.checker, which is the CheckerFactory that deploys new checkers.
  // FreeForAllPolicyFactory.deploy(address checker) expects this instance, not the factory.
  const freeForAllChecker = storage.getAddress(ECheckers.FreeForAll, network) ?? ZERO_ADDRESS;

  const coordinatorPublicKeyValue = networkConfig[EContracts.ZuGovRegistry].coordinatorPublicKey;
  const coordinatorPublicKey = typeof coordinatorPublicKeyValue === "string" ? coordinatorPublicKeyValue : "";

  const policyFactories = Object.fromEntries(
    POLICY_MAPPINGS.map(({ frontendKey, policyFactory, checkerFactory }) => [
      frontendKey,
      {
        policy: storage.getAddress(policyFactory, network) ?? ZERO_ADDRESS,
        checker: storage.getAddress(checkerFactory, network) ?? ZERO_ADDRESS,
      },
    ]),
  );

  const policyInfrastructure: Record<string, string> = {
    // No deploy step wires up an AnonAadhaar verifier in deploy-config.json yet.
    anonAadhaarVerifier: ZERO_ADDRESS,
  };

  INFRASTRUCTURE_FIELDS.forEach(({ field, contract, configKey }) => {
    const value = networkConfig[contract][configKey];
    policyInfrastructure[field] = isHexAddress(value) ? value : ZERO_ADDRESS;
  });

  const output = `/**
 * AUTO-GENERATED by packages/contracts/scripts/syncFrontendConfig.ts — do not edit by hand.
 * Regenerate with: pnpm --filter @extended-maci/contracts run sync-frontend-config -- --network ${network}
 */
import type { Hex } from "viem";

export const registryAddress = "${registryAddress}" as const satisfies Hex;

export const policyFactories = ${JSON.stringify(policyFactories, null, 2)} as const satisfies Record<
  string,
  { checker: Hex; policy: Hex }
>;

export const policyInfrastructure = ${JSON.stringify(policyInfrastructure, null, 2)} as const satisfies Record<string, Hex>;

export const constantVoiceCreditProxyFactory = "${constantVoiceCreditProxyFactory}" as const satisfies Hex;

export const freeForAllChecker = "${freeForAllChecker}" as const satisfies Hex;

/** Serialized MACI coordinator public key ("macipk.XXX"), from deploy-config.json's ZuGovRegistry section. */
export const coordinatorPublicKey = ${JSON.stringify(coordinatorPublicKey)};
`;

  fs.mkdirSync(FRONTEND_GENERATED_DIR, { recursive: true });
  const outputPath = path.resolve(FRONTEND_GENERATED_DIR, `${network}.ts`);
  fs.writeFileSync(outputPath, output);

  // eslint-disable-next-line no-console
  console.log(`Wrote frontend config for ${network} to ${outputPath}`);
}

main();
