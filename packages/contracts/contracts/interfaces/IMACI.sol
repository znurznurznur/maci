// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Params } from "../utilities/Params.sol";
import { DomainObjs } from "../utilities/DomainObjs.sol";

/// @title IMACI
/// @notice MACI interface
interface IMACI {
  /// @notice A struct holding the addresses of poll, messageProcessor and tally
  struct PollContracts {
    address poll;
    address messageProcessor;
    address tally;
  }

  struct PollData {
    uint256 id;
    string name;
    string metadata;
    uint256 startTime;
    uint256 endTime;
    string[] options;
    bytes[] optionInfo;
    DomainObjs.PublicKey coordinatorPubKey;
    address pollDeployer;
    DomainObjs.Mode mode;
    address policy;
    DomainObjs.Policy policyType;
  }
  /// @notice A struct holding the params for poll deployment
  struct DeployPollArgs {
    /// @param startDate The start date of the poll
    uint256 startDate;
    /// @param endDate The end date of the poll
    uint256 endDate;
    /// @param treeDepths The depth of the Merkle trees
    Params.TreeDepths treeDepths;
    /// @param messageBatchSize The message batch size
    uint8 messageBatchSize;
    /// @param coordinatorPublicKey The coordinator's public key
    DomainObjs.PublicKey coordinatorPublicKey;
    /// @param mode Voting mode
    DomainObjs.Mode mode;
    /// @param policy The policy contract
    address policy;
    /// @param initialVoiceCreditProxy The initial voice credit proxy contract
    address initialVoiceCreditProxy;
    /// @param relayer The message relayer (optional)
    address[] relayers;
    /// @param voteOptions The number of valid vote options for the poll
    uint256 voteOptions;
    /// @param name The name of the poll
    string name;
    /// @param metadata The metadata of the poll
    string metadata;
    /// @param options The voting options
    string[] options;
    /// @param optionInfo Additional info for each option
    bytes[] optionInfo;
    /// @param policyType The type of the sign-up policy
    DomainObjs.Policy policyType;
  }

  /// @notice Get the depth of the state tree
  /// @return The depth of the state tree
  function stateTreeDepth() external view returns (uint8);

  /// @notice Return the main root of the StateAq contract
  /// @return The Merkle root
  function getStateTreeRoot() external view returns (uint256);

  /// @notice Get the index of a public key in the state tree
  /// @param _publicKeyHash The hash of the public key
  /// @return index The index of the public key in the state tree
  function getStateIndex(uint256 _publicKeyHash) external view returns (uint256);

  /// @notice Deploy a new Poll contract.
  /// @param _pollArgs The deploy poll args
  function deployPoll(
    DeployPollArgs memory _pollArgs,
    address deployer
  ) external returns (PollData memory, PollContracts memory);

  /// @notice Allows any eligible user sign up. The sign-up policy should prevent
  /// double sign-ups or ineligible users from doing so.  This function will
  /// only succeed if the sign-up deadline has not passed.
  /// @param _publicKey The user's desired public key.
  /// @param _signUpPolicyData Data to pass to the sign-up policy
  ///     register() function. For instance, the POAPPolicy or
  ///     TokenPolicy requires this value to be the ABI-encoded
  ///     token ID.
  function signUp(DomainObjs.PublicKey memory _publicKey, bytes memory _signUpPolicyData) external;

  /// @notice Return the state root when the '_index' user signed up
  /// @param _index The serial number when the user signed up
  /// @return The Merkle root
  function getStateRootOnIndexedSignUp(uint256 _index) external view returns (uint256);

  /// @notice Get the number of signups
  /// @return totalSignups The number of signups
  function totalSignups() external view returns (uint256);

  /// @notice Get the next poll ID
  /// @return The next poll ID
  function nextPollId() external view returns (uint256);

  /// @notice Get the governance configuration for this MACI instance
  /// @return The governance config (supported modes, max vote options, allowed policies)
  function getGovernanceConfig() external view returns (DomainObjs.GovernanceConfig memory);

  /// @notice Replace the set of supported voting modes
  /// @param modes The new list of allowed modes (must be non-empty)
  function setSupportedModes(DomainObjs.Mode[] calldata modes) external;

  /// @notice Replace the set of allowed poll-level sign-up policies
  /// @param policies The new list of allowed policy types (must be non-empty)
  function setAllowedPolicies(DomainObjs.Policy[] calldata policies) external;
}
