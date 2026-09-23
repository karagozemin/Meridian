# Meridian

**Pre-trade price and liquidity check for tokenized stocks on X Layer.**

Before you buy a tokenized equity on X Layer, Meridian shows you what you are actually
paying and which source that price rests on.

Meridian does not claim to discover a fair value. It measures what can be measured and
labels every number with where it came from and how old it is.

---

## The problem

Tokenized equities trade continuously on X Layer, but the underlying US market does not.
Across NVDAx, TSLAx and AAPLx over a fixed six-day window, **68.8% of volume occurred
outside the regular US session**, and **24.5% of it occurred while no venue was quoting
the underlying at all** — not pre-market, not the overnight session, simply closed.

Those two figures are deliberately kept apart. Extended and overnight trading still have a
reference behind them; only the fully closed share does not. The measurement uses
30-minute candles because they align exactly to both session boundaries, classifies each
candle in Eastern Time so it survives daylight-saving shifts, and writes the raw API
responses to disk so the number can be recomputed against identical input
(`npm run volume-study`).

Outside regular hours, three things are true at once and none of them are visible at the
moment of trade:

1. **OKX's two price feeds do not diverge for these assets.** `market index` is documented
   as an aggregate of multiple sources, and for control tokens it behaves that way. For
   the tokenized equities measured here it returns the same value as `market price` to
   the last decimal. That is an observation about two responses, not a description of
   how the index is built.

2. **The issuer does publish a reference**, free and without authentication, sourced from
   Nasdaq with Blue Ocean covering overnight and extended hours. Nothing puts it in front
   of the user at the point of trade.

3. **Headline liquidity overstates tradable depth.** NVDAx shows over $1.3M across its
   pools, but only ~59% of that is quoted against a stablecoin, and a $112k sell clears
   well over a percent away from the displayed price.

## What Meridian shows

| Question | What is displayed |
|---|---|
| What do I actually get for this amount? | Live router quote and effective price for your size |
| Why does that differ from the displayed price? | Slippage ladder across trade sizes |
| Expensive or cheap relative to what? | Gap to the issuer's quote, with source and fetch time |
| Is the reference current? | Issuer session period, plus the fact that the issuer publishes no generation time, so the age is unknown |
| Is OKX's price independent? | `market price` vs `market index`, with control tokens beside it |
| Has a corporate action accrued? | Wrapped-to-underlying rate from the vault. One bare token is one share; the wrapper is not 1:1 |
| Can I prepare a trade? | A second, fresh quote. Effective price, minimum received, gap, and deadline. The first quote is not reused |
| What could you not check? | Unavailable feeds are shown blank, never estimated |

Meridian does not sign and does not submit a transaction. A deviation from the issuer
reference is a measurement, not protection. The minimum received and the deadline are
the figures that would be passed to the router; until a wallet signs, they stay on the
confirmation screen.

## Run the page

```bash
npm install
npm run panel
```

Open [http://localhost:4173](http://localhost:4173). Pick an asset and a size, then
**Check this size**. The recorded series is on the same page: how many readings, over
what window, and the issuer period of each. It does not claim the gap widens on weekends.

**Prepare this trade** takes a new quote and shows how it moved. Nothing is signed.

## Verify it yourself

Every finding above is reproducible from a terminal. Nothing is precomputed.

```bash
npm install
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

The control tokens are the point. They show the two feeds genuinely diverging, which is
what makes the exact equality on the equities a finding rather than a coincidence.

## Commands

```bash
npm run probe              # reproduce the index-feed comparison
npm run sample             # one full observation per tracked asset
npm run sample -- NVDAx    # a single asset
npm run sampler            # continuous collection, default 5 min interval
npm run sampler -- --interval 60
npm run panel              # pre-trade page at http://localhost:4173
npm run attest -- NVDAx 10 # print one attestation record; does not broadcast
npm run test:contract      # attestation contract and sourcesHash
npm run typecheck
```

## Architecture

```
src/
  config/assets.ts      tracked assets, control tokens, quote size ladder
  lib/
    onchainos.ts        OKX CLI wrapper, JSON envelope handling
    xstocks.ts          issuer public API: price-data, multiplier, asset registry
    session.ts          DST-aware US session clock incl. Blue Ocean overnight
    store.ts            append-only JSONL sample log
    format.ts           display helpers
  core/
    quotes.ts           slippage ladder from the DEX aggregator
    index-probe.ts      market price vs market index, with controls
    depth.ts            pool composition and stable-quoted share
    sample.ts           one complete observation
    panel.ts            formats a sample for the pre-trade page
    series.ts           recorded readings for one calculation version
    prepare.ts          fresh quote, difference from the panel, no signature
    attest.ts           one sample → attestation record, or a refusal
  contracts/
    MeridianAttestation.sol
  server/
    panel-server.ts     single-page pre-trade check
  cli/
    probe.ts            live index comparison
    sample-once.ts      single observation, rendered and logged
    sampler.ts          continuous collector
```

Each feed fails independently. A partial observation is recorded with a warning rather
than discarded, because a gap in the series is worse than a row with a hole in it — and
because a feed being down is itself something the product reports.

## Requirements

- Node.js 20 or newer
- [`onchainos`](https://github.com/okx/onchainos-skills) CLI 4.6.2 or newer, on `PATH`
- A logged-in wallet (`onchainos wallet status`) for anything that executes a trade

Read-only commands (`probe`, `sample`, `sampler`) do not require a funded wallet.

## Data

`data/samples.jsonl` is an append-only log, one JSON object per observation. It is
gitignored because it grows continuously and is regenerated by running the sampler.

The divergence history between the pool price and the issuer reference is the one thing
that cannot be reconstructed after the fact. The sampler needs to be running while it
happens.

## Status

Built for OKX Dev Day 2026, Build a Market track. The pre-trade page, the recorded
series, and the confirmation screen run locally.

`MeridianAttestation` is on X Layer mainnet (chain 196) at
`0x1246cD8Ef1a87B0F984Eb395023e7e23C70aD267`. Deploy transaction
`0x2c2b880c724ce3155dcf4dd502d32f16298f87222a480dc8d0292ad0fefe13f6`.
The attestor is `0x6A495d0598033c8372D457594ee60f469dEe7FBf`. Measurement `0`
is an NVDAx reading written in transaction
`0x21ede576237fb4b63f712b7f0b77f5f4479e29e21c5899e0716b837cb01acb95`.
A record proves Meridian's claim, not the correctness of the price.
`npm run attest` still prints a measurement and does not broadcast it.

## License

MIT
