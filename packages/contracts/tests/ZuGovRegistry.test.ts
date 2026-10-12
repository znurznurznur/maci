import { expect } from "chai";
import { ethers } from "hardhat";

import type { ZuGovRegistry } from "../typechain-types";
import type { Signer } from "ethers";

describe("ZuGovRegistry", () => {
  let registry: ZuGovRegistry;
  let owner: Signer;
  let nonOwner: Signer;

  const ZERO = "0x0000000000000000000000000000000000000000";
  const ADDR1 = "0x1111111111111111111111111111111111111111";
  const ADDR2 = "0x2222222222222222222222222222222222222222";
  const ADDR3 = "0x3333333333333333333333333333333333333333";
  const ADDR4 = "0x4444444444444444444444444444444444444444";
  const ADDR5 = "0x5555555555555555555555555555555555555555";
  const ADDR6 = "0x6666666666666666666666666666666666666666";
  const ADDR7 = "0x7777777777777777777777777777777777777777";
  const ADDR8 = "0x8888888888888888888888888888888888888888";
  const ADDR9 = "0x9999999999999999999999999999999999999999";
  const ADDRA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const fullInfra = {
    pollFactory: ADDR1,
    messageProcessorFactory: ADDR2,
    tallyFactory: ADDR3,
    verifier: ADDR4,
    verifyingKeysRegistry: ADDR5,
    poseidonT3: ADDR6,
    poseidonT4: ADDR7,
    poseidonT5: ADDR8,
    poseidonT6: ADDR9,
    signUpPolicy: ADDRA,
    coordinatorPubKeyX: 12345n,
    coordinatorPubKeyY: 67890n,
  };

  before(async () => {
    [owner, nonOwner] = await ethers.getSigners();

    const factory = await ethers.getContractFactory("ZuGovRegistry", owner);
    registry = (await factory.deploy()) as ZuGovRegistry;
    await registry.deploymentTransaction()?.wait();
  });

  describe("setInfrastructure", () => {
    it("allows owner to set all infrastructure fields", async () => {
      await registry.setInfrastructure(fullInfra);
      const infra = await registry.getInfrastructure();

      expect(infra.pollFactory).to.eq(ADDR1);
      expect(infra.messageProcessorFactory).to.eq(ADDR2);
      expect(infra.tallyFactory).to.eq(ADDR3);
      expect(infra.verifier).to.eq(ADDR4);
      expect(infra.verifyingKeysRegistry).to.eq(ADDR5);
      expect(infra.poseidonT3).to.eq(ADDR6);
      expect(infra.poseidonT4).to.eq(ADDR7);
      expect(infra.poseidonT5).to.eq(ADDR8);
      expect(infra.poseidonT6).to.eq(ADDR9);
      expect(infra.coordinatorPubKeyX).to.eq(12345n);
      expect(infra.coordinatorPubKeyY).to.eq(67890n);
    });

    it("emits InfrastructureUpdated", async () => {
      const fresh = await ethers.getContractFactory("ZuGovRegistry", owner);
      const reg2 = await fresh.deploy();
      await reg2.deploymentTransaction()?.wait();

      const tx = await reg2.setInfrastructure(fullInfra);
      await expect(tx).to.emit(reg2, "InfrastructureUpdated");
    });

    it("reverts when called by non-owner", async () => {
      await expect(registry.connect(nonOwner).setInfrastructure(fullInfra)).to.be.reverted;
    });
  });

  describe("getInfrastructure", () => {
    it("returns zero struct before any writes", async () => {
      const factory = await ethers.getContractFactory("ZuGovRegistry", owner);
      const fresh = (await factory.deploy()) as ZuGovRegistry;
      await fresh.deploymentTransaction()?.wait();

      const infra = await fresh.getInfrastructure();
      expect(infra.pollFactory).to.eq(ZERO);
      expect(infra.poseidonT3).to.eq(ZERO);
      expect(infra.coordinatorPubKeyX).to.eq(0n);
    });

    it("returns correct struct after setInfrastructure", async () => {
      const factory = await ethers.getContractFactory("ZuGovRegistry", owner);
      const reg2 = (await factory.deploy()) as ZuGovRegistry;
      await reg2.deploymentTransaction()?.wait();

      await reg2.setInfrastructure(fullInfra);

      const infra = await reg2.getInfrastructure();
      expect(infra.pollFactory).to.eq(ADDR1);
      expect(infra.poseidonT3).to.eq(ADDR6);
      expect(infra.signUpPolicy).to.eq(ethers.getAddress(ADDRA));
      expect(infra.coordinatorPubKeyX).to.eq(12345n);
    });
  });
});
