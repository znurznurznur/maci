// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title ZuGovRegistry
/// @notice Per-chain registry of shared MACI infrastructure: factory contracts,
///         Poseidon libraries, verifying keys registry, and coordinator public key.
///         Deployed once per network by the ZuGov team. All fields are owner-managed.
contract ZuGovRegistry is Ownable2Step {
  struct Infrastructure {
    // Factory contracts — pre-deployed by ZuGov team; owner-managed
    address pollFactory;
    address messageProcessorFactory;
    address tallyFactory;
    address verifier;
    address verifyingKeysRegistry;
    // Poseidon hash libraries required for MACI bytecode linking
    address poseidonT3;
    address poseidonT4;
    address poseidonT5;
    address poseidonT6;
    // Legacy field — present for backwards compatibility; unused by the frontend
    address signUpPolicy;
    // ZuGov coordinator MACI public key (owner-only)
    uint256 coordinatorPubKeyX;
    uint256 coordinatorPubKeyY;
  }

  Infrastructure public infrastructure;

  event InfrastructureUpdated(Infrastructure infra);

  error ZeroAddress(string field);

  constructor() Ownable(msg.sender) {}

  /// @notice Returns the full infrastructure struct.
  function getInfrastructure() external view returns (Infrastructure memory) {
    return infrastructure;
  }

  /// @notice Overwrites the full infrastructure struct. Owner only.
  function setInfrastructure(Infrastructure calldata infra) external onlyOwner {
    infrastructure = infra;
    emit InfrastructureUpdated(infra);
  }
}
