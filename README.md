<p align="center">
  <img src="meridian.png" alt="Meridian" width="300" />
</p>

# Meridian

Meridian measures what a tokenized-stock **sale** on X Layer would actually clear at, restates that proceeds in **USD per underlying share**, and sets the figure beside the **issuer's reference** before anyone trades.

It is a pre-trade instrument. It is not a wallet, not a router, and not a fair-value oracle.

How the pieces fit is in [ARCHITECTURE.md](ARCHITECTURE.md)

## What Meridian is

A reading is a sale of the wrapped token into USDG. The pools quote wNVDAx, wTSLAx, and wAAPLx. Meridian asks the router what a chosen size of that wrapped token would deliver, then converts the proceeds into USD per underlying share. The screen answers what the sale would return. It does not answer what a buyer would pay.

Two rates sit under that number. Neither is assumed to be 1.

The wrapper is ERC-4626. `convertToAssets(1e18)` is the assets-per-share rate, stored as the raw decimal the contract returned. One bare xStock is one share. The wrapper is not 1:1. The issuer's multiplier is the same correction, so it is not applied a second time. If the rate cannot be verified, the comparison is withheld.

USDG is the quote token. It is not treated as one dollar. USDG/USD is read live, and the effective price is compared with the issuer only after that restatement. If parity is missing, the USD fields stay blank. The LP fee is already inside the router's `toTokenAmount`. It is not subtracted again.

Next to the sale is the issuer's public reference, `price-data` from `api.xstocks.fi`. The issuer does not say when that price was produced. The page shows when Meridian fetched it. Fetch time is not the age of the price.

The session is the issuer's own `currentPeriod`: market, extended, overnight, or closed. An unreported period is left unreported. A local clock is kept only as a cross-check. It does not decide the regime.

OKX exposes two feeds, `market price` and `market index`. Meridian prints both for the three stocks and for two control tokens that are not equities, USDG and WOKB. On these stocks the two feeds have returned the same value at the same observation time. The control tokens diverge. That is an observation about two responses. It is not a claim about how the index is built, and `market price` is not a reading of one pool's reserves.

Size is a ladder of wrapped-token amounts: 1, 10, 50, 200, 500, 1000. The result is a size-dependent quote curve. Realized slippage can be measured only after a trade, and Meridian does not submit one. A 500-token quote is not a $100,000 trade. The notional is whatever that quote returned.

**Prepare** takes a second quote. The number already on the panel is never the one prepared. The screen shows effective USD, minimum received, the gap, and a deadline of 120 seconds from the fresh sample. Those two limits are displayed. They are not passed to a router. Nothing is signed. Nothing is broadcast. The only state is `prepared`.

One measurement is on X Layer mainnet, in `MeridianAttestation`. The page reads it. The sampler does not write it. `npm run attest` prints a measurement and does not broadcast it. A record proves Meridian's claim. It does not prove the price was correct. `sourcesHash` binds the inputs of that claim. It is not a certificate of accuracy.

A failed feed is a blank and a reason. Missing numbers are not filled with 1, with zero, or with the previous sample.

## The problem

That instrument exists because the number on a token page is not the number a sale clears at, and the US market the token refers to is not open for most of the volume.

Tokenized equities trade continuously on X Layer. The underlying US market does not. Across NVDAx, TSLAx, and AAPLx, over one fixed six-day window of 30-minute candles aligned to both session boundaries:

- **68.8%** of volume traded outside the regular US session.
- **24.5%** of volume traded while no venue was quoting the underlying.

These are two shares of the same volume. They are not one figure. Extended and overnight hours still have a reference. Only the fully closed share does not. "68.8% had no reference" is false. Reproduce the split with `npm run volume-study`.

Three further facts are true at the moment of a sale, and none of them are on the token page.

1. **The two OKX feeds match on these equities and diverge on the controls.** `market index` is documented as an aggregate. For USDG and WOKB the feeds separate. For NVDAx, TSLAx, and AAPLx they have matched to the last decimal. Same observation time, same value. No inference about construction.

2. **The issuer already publishes a reference**, free and without a key. Nothing on the trade path puts it next to the quote. There is also no generation timestamp, so "the reference is zero minutes old" cannot be said.

3. **Headline liquidity overstates what a sale can lift.** NVDAx shows over $1.3M across its pools. About 59% of that is quoted against a stablecoin. A 500-token sell, about $112,761 of notional in the locked quote, cleared at 222.78 against a displayed price near 225.54. That is −1.21%. It is a quote, not realized slippage.

## What the page shows

| Question | What is displayed |
|---|---|
| What does a sale of this size return? | Live router quote, USDG proceeds, effective USD per underlying share |
| What does size cost, apart from the small-trade price? | Gap at the requested size, and gap at the smallest rung |
| Relative to what? | Issuer reference, with the source and the fetch time |
| How old is the reference? | Unknown. Only the fetch time is known |
| Which session is this? | The issuer's `currentPeriod`, read live |
| Do OKX's two feeds agree here? | `market price` vs `market index`, with USDG and WOKB beside them |
| Is the wrapper 1:1? | `convertToAssets`. One bare token is one share. The wrapper is not |
| Can I prepare the sale? | A second quote, only when reference and USD both exist |
| What was written on X Layer? | The stored measurement, read back. It proves the claim, not the price |
| What failed? | A blank, with the reason |

**Prepare this trade** stays hidden when the comparison is withheld. When it runs, it shows effective price, minimum received, the gap, and the deadline. No transaction has been signed or submitted.

## Run it

```bash
npm install
npm run panel
```

Open [https://meridian-l2cp.onrender.com](http://meridian-l2cp.onrender.com)

The landing page states the two volume figures, then **Open the instrument**. Pick an asset and a size, then **Check this size**. Four views:

- **Reading** — the sale at this size, and prepare when a comparison exists
- **Depth** — the quote ladder, pools, index comparison, session, parity
- **Tape** — the recorded series, one calculation version only
- **Chain** — measurement 0, read back from X Layer

The series does not claim the gap widens on weekends or closes at the open. It shows the readings that exist, the window they cover, and the issuer period of each.

## Verify a finding

```bash
npm run probe
```

Sample output, taken during a regular session:

```
TOKEN                 market price            market index    divergence   identical
NVDAx                   225.390002              225.390002      +0.0000%         yes
TSLAx                   379.135013              379.135013      +0.0000%         yes
AAPLx                   336.920004              336.920004      +0.0000%         yes

Control tokens (the same two feeds, assets that are not equities):
USDG            0.9998990726017167                       1      +0.0101%          no
WOKB            118.01986891785704                  117.82      -0.1694%          no
```

The control tokens are the point. They show the two feeds diverging, which is what makes the match on the equities a finding rather than a property of the endpoint.

## Commands

```bash
npm run probe              # market price vs market index, plus controls
npm run sample             # one observation per tracked asset
npm run sample -- NVDAx    # one asset
npm run sampler            # five-minute schedule; coverage has gaps
npm run sampler -- --interval 60
npm run volume-study       # recompute the 68.8% / 24.5% split
npm run panel              # https://meridian-l2cp.onrender.com
npm run attest -- NVDAx 10 # print one record; does not broadcast
npm run test:contract      # Solidity tests and the sourcesHash fixture
npm run typecheck
```

## On X Layer

`MeridianAttestation` is on mainnet, chain 196, at
`0x1246cD8Ef1a87B0F984Eb395023e7e23C70aD267`.

| | |
|---|---|
| Deploy | `0x2c2b880c724ce3155dcf4dd502d32f16298f87222a480dc8d0292ad0fefe13f6` |
| Attestor | `0x6A495d0598033c8372D457594ee60f469dEe7FBf` |
| Measurement 0 | NVDAx, tx `0x21ede576237fb4b63f712b7f0b77f5f4479e29e21c5899e0716b837cb01acb95` |

The attestor is a dedicated writer. It is not the sampler, and it is not the page. One record exists. That is a declaration on mainnet, not continuous on-chain verification. Addresses and the first record are in `deployments/xlayer.json`.

## Requirements

- Node.js 20 or newer
- [`onchainos`](https://github.com/okx/onchainos-skills) CLI 4.6.2 or newer, on `PATH`
- Foundry, only if you run `npm run test:contract`

Quotes go through the CLI. The panel process holds no private key. The sampler only reads, and it does not write the contract.

## Data

`data/samples.jsonl` is an append-only log, one JSON object per sampler observation. It is gitignored. Panel and prepare readings are not appended to it.

The sampler runs on a five-minute schedule. As of 2026-09-24T14:36:57Z the log held 306 observations over a 19.6-hour window, 102 per asset. That is not uninterrupted five-minute coverage. The gap between an executable sale and the issuer reference cannot be reconstructed after the fact, so the sampler has to be running while the session is open.

Rows from an older calculation are quarantined and are not merged into this series. The current calculation version is `2026-09-23.3-usd-denominated`.

## Status

Built for OKX Dev Day 2026, Build a Market. The page, the series, the prepare screen, and the on-chain readback run locally against live X Layer and the issuer's public API.

## License

MIT
