import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { Contract, ZeroAddress, toUtf8Bytes, getAddress, type Log, type Interface } from "ethers";
import { PublicKey } from "@extended-maci/domainobjs";
import { MACI__factory, Poll__factory, ConstantVoiceCreditProxyFactory__factory } from "../poll-factory-shim";
import { GovernanceTypes, PolicyType, type GovernanceType, type PollDeployConfig } from "../config";
import { SET_TARGET_ABI } from "../services/policyDeploy";
import { getSignerFromWagmiConfig } from "../services/wagmiSigner";
import { wagmiConfig } from "../services/wagmiConfig";
import { decodeContractError } from "../lib/decodeContractError";

/** EMode enum values matching DomainObjs.Mode on-chain */
export const EMode = { QV: 0, NON_QV: 1, FULL: 2, RANKED: 3 } as const;

export function votingMechanismToMode(mechanism: string): number {
  if (mechanism === "quadratic") return EMode.QV;
  if (mechanism === "ranked") return EMode.RANKED;
  if (mechanism === "full") return EMode.FULL;
  return EMode.NON_QV; // "simple" → 1-person-1-vote
}

export interface DeployPollFormData {
  title: string;
  description: string;
  votingMechanism: string;
  startDate: string;
  endDate: string;
  eligibility: string;
  options: string[];
}

export interface UseDeployPollResult {
  isDeploying: boolean;
  deployStep: string | null;
  deployError: string | null;
  deployPoll: (args: {
    maciAddress: string;
    pollDeployConfig: PollDeployConfig;
    existingPollAddress: string | null;
    /** Address of the eligibility policy this poll should use — either an already-deployed
     * instance being reused, or one freshly deployed by the caller (see
     * src/services/policyDeploy.ts's deployPolicyContract) immediately before calling this. */
    policyAddress: string;
    formData: DeployPollFormData;
  }) => Promise<{ pollAddress: string; pollId: string; txHash: string }>;
}

export async function getEthersSigner() {
  return getSignerFromWagmiConfig(wagmiConfig);
}

async function resolveInitialVoiceCreditProxy(
  signer: Awaited<ReturnType<typeof getEthersSigner>>,
  existingPollAddress: string | null,
  constantVoiceCreditProxyFactory: string,
  initialVoiceCreditAmount: number,
): Promise<string> {
  if (existingPollAddress) {
    // Reuse the connected wallet's own provider (already on the community's actual chain)
    // instead of a hardcoded RPC endpoint — existingPollAddress could be on any supported chain.
    const poll = Poll__factory.connect(existingPollAddress, signer.provider);
    const ext = await poll.extContracts();
    return ext.initialVoiceCreditProxy;
  }

  // No existing poll — deploy a fresh ConstantInitialVoiceCreditProxy
  const factory = ConstantVoiceCreditProxyFactory__factory.connect(constantVoiceCreditProxyFactory, signer);
  const tx = await factory.deploy(initialVoiceCreditAmount);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("ConstantInitialVoiceCreditProxy deployment failed");

  return extractCloneAddress(receipt.logs, factory.interface, "ConstantInitialVoiceCreditProxy");
}

/** Extracts the clone address from a CloneDeployed event.
 * The `clone` param is indexed, so it lives in topics[1] as a 32-byte word. */
function extractCloneAddress(logs: readonly Log[], iface: Interface, label: string): string {
  const cloneDeployedTopic = iface.getEvent("CloneDeployed")!.topicHash;
  const log = logs.find((l) => l.topics[0] === cloneDeployedTopic);
  if (!log || !log.topics[1]) {
    throw new Error(`CloneDeployed event not found in ${label} deployment`);
  }
  // topics[1] is the 32-byte padded address; take last 20 bytes
  return getAddress(`0x${log.topics[1].slice(-40)}`);
}

export function useDeployPoll(governanceType: GovernanceType | undefined): UseDeployPollResult {
  const { address } = useAccount();
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStep, setDeployStep] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  const deployPoll = useCallback(
    async ({
      maciAddress,
      pollDeployConfig,
      existingPollAddress,
      policyAddress,
      formData,
    }: {
      maciAddress: string;
      pollDeployConfig: PollDeployConfig;
      existingPollAddress: string | null;
      policyAddress: string;
      formData: DeployPollFormData;
    }) => {
      if (!address) throw new Error("Wallet not connected");
      if (!governanceType || governanceType !== GovernanceTypes.MACI) {
        throw new Error(`deployPoll not supported for governance type "${governanceType}"`);
      }

      setIsDeploying(true);
      setDeployError(null);

      try {
        const signer = await getEthersSigner();

        setDeployStep("Resolving voice credit proxy...");
        const initialVoiceCreditProxy = await resolveInitialVoiceCreditProxy(
          signer,
          existingPollAddress,
          pollDeployConfig.constantVoiceCreditProxyFactory,
          pollDeployConfig.initialVoiceCreditAmount,
        );

        setDeployStep("Deploying poll...");
        const maci = MACI__factory.connect(maciAddress, signer);
        const coordinatorKey = PublicKey.deserialize(pollDeployConfig.coordinatorPublicKey);
        const coordinatorPubKeyParam = coordinatorKey.asContractParam();

        const options = formData.options.filter((o) => o.trim() !== "");
        const optionInfo = options.map(() => toUtf8Bytes(""));
        const policyTypeNum = Number(
          PolicyType[formData.eligibility as keyof typeof PolicyType] ?? PolicyType.FreeForAll,
        );

        const deployPollTx = await maci.deployPoll(
          {
            startDate: Math.floor(new Date(formData.startDate).getTime() / 1000),
            endDate: Math.floor(new Date(formData.endDate).getTime() / 1000),
            treeDepths: pollDeployConfig.treeDepths,
            messageBatchSize: pollDeployConfig.messageBatchSize,
            coordinatorPublicKey: coordinatorPubKeyParam,
            mode: votingMechanismToMode(formData.votingMechanism),
            policy: policyAddress,
            initialVoiceCreditProxy,
            relayers: [ZeroAddress],
            voteOptions: options.length,
            name: formData.title,
            metadata: formData.description,
            options,
            optionInfo,
            policyType: policyTypeNum,
          },
          address,
        );

        const deployReceipt = await deployPollTx.wait();
        if (!deployReceipt || deployReceipt.status !== 1) throw new Error("deployPoll transaction failed");

        const pollId = await maci.nextPollId().then((id) => id - 1n);
        const { contracts } = await maci.getPoll(pollId);

        setDeployStep("Setting policy target...");
        const policy = new Contract(policyAddress, SET_TARGET_ABI, signer);
        const setTargetTx = await (policy.setTarget as (guarded: string) => Promise<{ wait: () => Promise<unknown> }>)(
          contracts.poll,
        );
        await setTargetTx.wait();

        return { pollAddress: contracts.poll, pollId: pollId.toString(), txHash: deployPollTx.hash };
      } catch (err) {
        setDeployError(decodeContractError(err));
        throw err;
      } finally {
        setIsDeploying(false);
        setDeployStep(null);
      }
    },
    [address, governanceType],
  );

  return { isDeploying, deployStep, deployError, deployPoll };
}
