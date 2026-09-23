// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MeridianAttestation} from "../contracts/MeridianAttestation.sol";

contract MeridianAttestationTest {
    function _sample() internal pure returns (MeridianAttestation.Measurement memory measurement) {
        measurement = MeridianAttestation.Measurement({
            token: address(0xc845b2894dBddd03858fd2D643B4eF725fE0849d),
            effectivePriceUsd: 22_503_000_000,
            referencePriceUsd: 22_524_500_000,
            quoteTokenUsd: 99_936_000,
            assetsPerShare: 1_001_701_196_801_074_000,
            sizeTokens: 10 ether,
            sessionRegime: 1,
            referenceFetchedAt: 1_790_000_000,
            measuredAt: 1_790_000_001,
            sourcesHash: bytes32(uint256(1))
        });
    }

    function testRecordAndRead() public {
        MeridianAttestation book = new MeridianAttestation(address(this));
        MeridianAttestation.Measurement memory measurement = _sample();
        uint256 id = book.record(measurement);
        require(id == 0, "first id");
        require(book.nextId() == 1, "next");

        MeridianAttestation.Measurement memory stored = book.measurement(id);
        require(stored.token == measurement.token, "token");
        require(stored.effectivePriceUsd == measurement.effectivePriceUsd, "effective");
        require(stored.referencePriceUsd == measurement.referencePriceUsd, "reference");
        require(stored.quoteTokenUsd == measurement.quoteTokenUsd, "parity");
        require(stored.assetsPerShare == measurement.assetsPerShare, "rate");
        require(stored.sizeTokens == measurement.sizeTokens, "size");
        require(stored.sessionRegime == 1, "regime");
        require(stored.referenceFetchedAt == measurement.referenceFetchedAt, "fetched");
        require(stored.measuredAt == measurement.measuredAt, "measured");
        require(stored.sourcesHash == measurement.sourcesHash, "hash");
    }

    function testStrangerCannotRecord() public {
        MeridianAttestation book = new MeridianAttestation(address(this));
        Stranger stranger = new Stranger();
        try stranger.poke(book, _sample()) {
            require(false, "stranger wrote");
        } catch (bytes memory data) {
            require(bytes4(data) == MeridianAttestation.NotAttestor.selector, "selector");
        }
    }

    function testZeroRateIsRefused() public {
        MeridianAttestation book = new MeridianAttestation(address(this));
        MeridianAttestation.Measurement memory measurement = _sample();
        measurement.assetsPerShare = 0;
        try book.record(measurement) {
            require(false, "zero rate written");
        } catch (bytes memory data) {
            require(bytes4(data) == MeridianAttestation.IncompleteMeasurement.selector, "selector");
        }
    }

    function testUnknownRegimeIsRefused() public {
        MeridianAttestation book = new MeridianAttestation(address(this));
        MeridianAttestation.Measurement memory measurement = _sample();
        measurement.sessionRegime = 4;
        try book.record(measurement) {
            require(false, "regime 4 written");
        } catch (bytes memory data) {
            require(bytes4(data) == MeridianAttestation.IncompleteMeasurement.selector, "selector");
        }
    }

    function testRegularRegimeIsValid() public {
        MeridianAttestation book = new MeridianAttestation(address(this));
        MeridianAttestation.Measurement memory measurement = _sample();
        measurement.sessionRegime = 0;
        book.record(measurement);
        require(book.measurement(0).sessionRegime == 0, "regular");
    }

    function testTransferReplacesTheOnlyWriter() public {
        MeridianAttestation book = new MeridianAttestation(address(this));
        address next = address(0xBEEF);
        book.transferAttestor(next);

        try book.record(_sample()) {
            require(false, "old attestor still writes");
        } catch (bytes memory data) {
            require(bytes4(data) == MeridianAttestation.NotAttestor.selector, "selector");
        }

        require(book.attestor() == next, "attestor");
    }

    function testCannotTransferToZero() public {
        MeridianAttestation book = new MeridianAttestation(address(this));
        try book.transferAttestor(address(0)) {
            require(false, "zero attestor");
        } catch (bytes memory data) {
            require(bytes4(data) == MeridianAttestation.ZeroAttestor.selector, "selector");
        }
    }

    function testConstructorRejectsZero() public {
        try new MeridianAttestation(address(0)) {
            require(false, "constructed");
        } catch (bytes memory data) {
            require(bytes4(data) == MeridianAttestation.ZeroAttestor.selector, "selector");
        }
    }

    /// @dev Must match `cast keccak` of `cast abi-encode` over the same six fields,
    ///      in this order. See src/core/attest.ts.
    function testSourcesHashMatchesAbiEncode() public {
        MeridianAttestation book = new MeridianAttestation(address(this));
        bytes32 got = book.hashSources(
            "2026-09-23.3-usd-denominated",
            "onchainos 4.6.2",
            "https://api.xstocks.fi/api/v2/public/assets/NVDAx/price-data",
            "",
            0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5,
            0x4ae46a509F6b1D9056937BA4500cb143933D2dc8
        );
        require(
            got == 0xb534b3f57785581b2420f4537085ba75498b956821b6136f6e247bade544b6ed,
            "sources hash"
        );
    }
}

contract Stranger {
    function poke(
        MeridianAttestation book,
        MeridianAttestation.Measurement memory measurement
    ) external {
        book.record(measurement);
    }
}
