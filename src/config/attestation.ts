/**
 * MeridianAttestation as deployed on X Layer mainnet.
 *
 * The page only reads this contract. Writing still requires the attestor key, and
 * that key is not available to the panel process.
 */
export const ATTESTATION = {
  chainId: 196,
  address: "0x1246cD8Ef1a87B0F984Eb395023e7e23C70aD267",
  /** `nextId()` */
  nextIdSelector: "0x61b8ce8c",
  /** `measurement(uint256)` */
  measurementSelector: "0x1afce714",
} as const;
