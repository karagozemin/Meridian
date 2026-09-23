// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title MeridianAttestation
/// @notice A record proves Meridian's claim about a measurement. It does not prove
///         that the price was correct.
/// @dev One attestor may write. The role can be transferred and cannot be duplicated.
///      Field units are fixed: USD prices are 1e8, `assetsPerShare` and `sizeTokens`
///      are 1e18. `assetsPerShare` is the raw `convertToAssets(1e18)` reading.
contract MeridianAttestation {
    struct Measurement {
        address token;
        uint256 effectivePriceUsd;
        uint256 referencePriceUsd;
        uint256 quoteTokenUsd;
        uint256 assetsPerShare;
        uint256 sizeTokens;
        uint8 sessionRegime;
        uint64 referenceFetchedAt;
        uint64 measuredAt;
        bytes32 sourcesHash;
    }

    address public attestor;
    uint256 public nextId;
    mapping(uint256 => Measurement) private _measurements;

    event MeasurementRecorded(
        uint256 indexed id,
        address indexed token,
        uint8 indexed sessionRegime,
        uint256 effectivePriceUsd,
        uint256 referencePriceUsd,
        bytes32 sourcesHash
    );

    event AttestorTransferred(address indexed previousAttestor, address indexed nextAttestor);

    error NotAttestor();
    error ZeroAttestor();
    error IncompleteMeasurement();

    constructor(address initialAttestor) {
        if (initialAttestor == address(0)) revert ZeroAttestor();
        attestor = initialAttestor;
    }

    /// @dev `sourcesHash` is keccak256(abi.encode(...)) over the six source identifiers,
    ///      in this order. Not `abi.encodePacked`. The hash binds the setup that produced
    ///      the record, not the prices; those are stored in the clear.
    function hashSources(
        string memory calcVersion,
        string memory cliVersion,
        string memory referenceEndpoint,
        string memory routerQuoteId,
        address wrapperAddress,
        address quoteTokenAddress
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                calcVersion,
                cliVersion,
                referenceEndpoint,
                routerQuoteId,
                wrapperAddress,
                quoteTokenAddress
            )
        );
    }

    function record(Measurement calldata reading) external returns (uint256 id) {
        if (msg.sender != attestor) revert NotAttestor();
        if (!_complete(reading)) revert IncompleteMeasurement();

        id = nextId;
        nextId = id + 1;
        _measurements[id] = reading;

        emit MeasurementRecorded(
            id,
            reading.token,
            reading.sessionRegime,
            reading.effectivePriceUsd,
            reading.referencePriceUsd,
            reading.sourcesHash
        );
    }

    function measurement(uint256 id) external view returns (Measurement memory) {
        return _measurements[id];
    }

    function transferAttestor(address nextAttestor) external {
        if (msg.sender != attestor) revert NotAttestor();
        if (nextAttestor == address(0)) revert ZeroAttestor();
        emit AttestorTransferred(attestor, nextAttestor);
        attestor = nextAttestor;
    }

    /// @dev A zero rate, a zero price, or a regime outside 0..3 is not a measurement.
    ///      Session regime 0 (regular) is valid. An incomplete record is refused so a
    ///      partial observation is never written.
    function _complete(Measurement calldata reading) private pure returns (bool) {
        return reading.token != address(0)
            && reading.effectivePriceUsd != 0
            && reading.referencePriceUsd != 0
            && reading.quoteTokenUsd != 0
            && reading.assetsPerShare != 0
            && reading.sizeTokens != 0
            && reading.sessionRegime <= 3
            && reading.referenceFetchedAt != 0
            && reading.measuredAt != 0
            && reading.sourcesHash != bytes32(0);
    }
}
