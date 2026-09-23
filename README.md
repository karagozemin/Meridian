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

1. **OKX has no independent reference for these assets.** `market index` is documented as
   an aggregate of multiple sources, and for control tokens it behaves that way. For
   tokenized equities it returns the pool price to the last decimal — so if the pool
   moves, the index moves with it.

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
| Is the reference current? | Session regime: regular / extended / overnight / closed |
| Is OKX's price independent? | `market price` vs `market index`, with control tokens |
| Has a corporate action occurred? | Issuer multiplier, and whether it was applied |
| Can I proceed? | User-confirmed swap with a deadline and a minimum received |
| What could you not check? | Unavailable feeds are shown blank, never estimated |

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

Built for OKX Dev Day 2026, Build a Market track. Early — see the command list above for
what currently runs.

## License

MIT
