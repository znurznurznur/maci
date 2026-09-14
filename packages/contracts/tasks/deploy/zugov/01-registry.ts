import { PublicKey } from "@znurznurznur/extended-maci-domainobjs";

import type { ZuGovRegistry } from "../../../typechain-types";

import { logGreen, info } from "../../../ts/logger";
import { EDeploySteps, FULL_POLICY_NAMES } from "../../helpers/constants";
import { ContractStorage } from "../../helpers/ContractStorage";
import { Deployment } from "../../helpers/Deployment";
import { EContracts, type IDeployParams } from "../../helpers/types";

const deployment = Deployment.getInstance();
const storage = ContractStorage.getInstance();

// Known infrastructure addresses on Scroll Sepolia (from deployed-contracts.json).
// On other networks these are read from storage (deployed by the maci steps).
const SCROLL_SEPOLIA_INFRA = {
  pollFactory: "0x9746D3e26eAf14ad81FD80C8fa9ea71683cA2cf2",
  messageProcessorFactory: "0x7F014679d482B0C5165A6b012ECDa688384a62DD",
  tallyFactory: "0x3A055163f0e158F9009b287371bFc25d27d0C82c",
  verifier: "0xad06D4D313662646329992E8AAf9218B6c0b74a8",
  verifyingKeysRegistry: "0x3f9aD01778a3ac1043Df316E3801b8E899b1c114",
  poseidonT3: "0x3772ef2ADf52CCe433F5acE45ca013A63E56BBd1",
  poseidonT4: "0x276E96615bd8741D36D6F431008F8BDcfa4d74F7",
  poseidonT5: "0x57a0AD17b372104E6Ca63BC8412Ef3a2cf5Fa3e3",
  poseidonT6: "0xf7f1CEdb374bA4f66630B15F608469F35E7944c3",
  signUpPolicy: "0x62de1cBD5002cAD2cE5449067db59e8629f81192",
  coordinatorPubKeyX: BigInt("8201437029920976330594040737871993995175068840909348280756782472788937010943"),
  coordinatorPubKeyY: BigInt("5916566997409241411472482524911982262118947641843646973369449990038302399121"),
};

deployment.deployTask(EDeploySteps.ZuGovRegistry, "Deploy ZuGovRegistry").then((task) =>
  task.setAction(async ({ incremental }: IDeployParams, hre) => {
    deployment.setHre(hre);
    const deployer = await deployment.getDeployer();

    const existingAddress = storage.getAddress(EContracts.ZuGovRegistry, hre.network.name);

    if (incremental && existingAddress) {
      logGreen({ text: info(`Skipping deployment of ${EContracts.ZuGovRegistry} — already at ${existingAddress}`) });
      return;
    }

    const factory = await hre.ethers.getContractFactory(EContracts.ZuGovRegistry, deployer);
    const registry = (await factory.deploy()) as ZuGovRegistry;
    await registry.waitForDeployment();

    const isScrollSepolia = hre.network.name === "scroll_sepolia";

    let infra;
    if (isScrollSepolia) {
      infra = SCROLL_SEPOLIA_INFRA;
    } else {
      // Read from deploy-config.json (same field/section this network's deploy-config.json
      // already uses for Poll.coordinatorPublicKey — see tasks/deploy/poll/03-poll.ts) rather
      // than hardcoding a zero key. A zero coordinator key makes useZuGovRegistry's isReady
      // check false forever, silently blocking every wizard-driven community creation on this
      // network until someone notices and calls setInfrastructure() by hand.
      const coordinatorPublicKey = deployment.getDeployConfigField<string>(
        EContracts.ZuGovRegistry,
        "coordinatorPublicKey",
      );
      const coordinatorKey = PublicKey.deserialize(coordinatorPublicKey);

      infra = {
        pollFactory: storage.mustGetAddress(EContracts.PollFactory, hre.network.name),
        messageProcessorFactory: storage.mustGetAddress(EContracts.MessageProcessorFactory, hre.network.name),
        tallyFactory: storage.mustGetAddress(EContracts.TallyFactory, hre.network.name),
        verifier: storage.mustGetAddress(EContracts.Verifier, hre.network.name),
        verifyingKeysRegistry: storage.mustGetAddress(EContracts.VerifyingKeysRegistry, hre.network.name),
        poseidonT3: storage.mustGetAddress(EContracts.PoseidonT3, hre.network.name),
        poseidonT4: storage.mustGetAddress(EContracts.PoseidonT4, hre.network.name),
        poseidonT5: storage.mustGetAddress(EContracts.PoseidonT5, hre.network.name),
        poseidonT6: storage.mustGetAddress(EContracts.PoseidonT6, hre.network.name),
        signUpPolicy: storage.mustGetAddress(
          FULL_POLICY_NAMES[EContracts.FreeForAllPolicy] as unknown as EContracts,
          hre.network.name,
        ),
        coordinatorPubKeyX: coordinatorKey.raw[0],
        coordinatorPubKeyY: coordinatorKey.raw[1],
      };
    }

    const tx = await registry.setInfrastructure(infra);
    await tx.wait();

    await storage.register({
      id: EContracts.ZuGovRegistry,
      contract: registry,
      args: [],
      network: hre.network.name,
    });

    logGreen({ text: info(`ZuGovRegistry deployed at ${await registry.getAddress()}`) });
    logGreen({ text: info(`Update apps/zugov-frontend/src/config.ts registryAddress`) });
  }),
);
