# Meridian

**Pre-trade measurement for tokenized stocks on X Layer.**

A sell of NVDAx, TSLAx, or AAPLx does not clear at the price on the token page. Meridian
reads what the router would actually deliver for a chosen size, restates it in USD per
underlying share, and sets it next to the issuer's own reference. Every figure is a
measurement. A blank means the read failed.

Meridian does not compute a fair value. It does not sign, and it does not submit a swap.
A difference from the issuer reference is a measurement, not protection.

How the pieces fit is in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## The problem

Tokenized equities trade continuously on X Layer. The underlying US market does not.
Across NVDAx, TSLAx, and AAPLx, over a fixed six-day window:

- **68.8%** of volume traded outside the regular US session.
- **24.5%** of volume traded while no venue was quoting the underlying.

These are two shares of the same volume. They are not one figure. Extended and overnight
hours still have a reference; only the fully closed share does not. The measurement uses
30-minute candles aligned to both session boundaries, classified in Eastern Time.
Reproduce it with `npm run volume-study`.

Three things are true at the moment of trade, and none of them are on the token page:

1. **OKX's two price feeds return the same value for these equities.** `market index` is
   documented as an aggregate of multiple sources. For control tokens (USDG, WOKB) the two
   feeds diverge. For NVDAx, TSLAx, and AAPLx they match to the last decimal. That is an
   observation about two responses, not a claim about how the index is built.

2. **The issuer publishes a reference**, free and without authentication. Nothing puts it
   next to the quote at the point of trade. The issuer does not publish a generation
   timestamp, so the age of that price is unknown.

3. **Headline liquidity overstates tradable depth.** NVDAx shows over $1.3M across its
   pools, but only ~59% of that is quoted against a stablecoin, and a $112k sell clears
   well over a percent away from the displayed price.

## What the page shows

| Question | What is displayed |
|---|---|
| What does this size actually clear at? | Live router quote, effective USD per underlying share |
| What does size cost, apart from the quote? | Gap at the requested size, and gap at the smallest rung |
| Relative to what? | Issuer reference, with source and fetch time |
| Which session is this? | The issuer's `currentPeriod`, read live |
| Are OKX's two feeds independent here? | `market price` vs `market index`, with the control tokens beside them |
| Is the wrapper 1:1? | `convertToAssets` rate. One bare token is one share; the wrapper is not |
| Can I prepare a trade? | A second quote. The panel quote is never the one prepared |
| What was written on X Layer? | The stored measurement, read back. It proves the claim, not the price |
| What failed? | A blank, with the reason. Never a zero, never an estimate |

**Prepare this trade** appears only when the issuer reference and the USD restatement are
both present. It shows effective price, minimum received, the gap, and a deadline. Those
two figures are what a router call would take. This page does not pass them, because this
page does not sign.

## Run it

```bash
npm install
npm run panel
```

Open [http://localhost:4173](http://localhost:4173).

The landing page states the two volume figures, then **Open the instrument**. Pick an
asset and a size, then **Check this size**. The instrument has four views:

- **Reading** — the verdict for this size, and prepare when a comparison exists
- **Depth** — ladder, pools, index comparison, session, parity
- **Tape** — the recorded series, one calculation version only
- **Chain** — the latest measurement read back from X Layer

The series does not claim the gap widens on weekends or closes at the open. It shows the
readings that exist, the window they cover, and the issuer period of each.

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

The control tokens are the point. They show the two feeds diverging, which is what makes
the match on the equities a finding.

## Commands

```bash
npm run probe              # market price vs market index, plus controls
npm run sample             # one observation per tracked asset
npm run sample -- NVDAx    # one asset
npm run sampler            # continuous collection, default 5 min
npm run sampler -- --interval 60
npm run volume-study       # recompute the 68.8% / 24.5% split
npm run panel              # http://localhost:4173
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

A record proves Meridian's claim, not the correctness of the price. Addresses and the
first record are also in `deployments/xlayer.json`. The page only reads the contract.
`npm run attest` prints a measurement and does not broadcast it.

## Requirements

- Node.js 20 or newer
- [`onchainos`](https://github.com/okx/onchainos-skills) CLI 4.6.2 or newer, on `PATH`
- Foundry, only if you run `npm run test:contract`

Quotes go through the CLI. The panel process holds no private key. The sampler only
reads. Writing a new on-chain record is a separate step and is not what the page does.

## Data

`data/samples.jsonl` is an append-only log, one JSON object per sampler observation. It
is gitignored. Panel and prepare readings are not appended to it.

The gap between pool price and issuer reference cannot be reconstructed after the fact.
The sampler has to be running while it happens.

## Status

Built for OKX Dev Day 2026, Build a Market. The page, the series, the prepare screen,
and the on-chain readback run locally against live X Layer and the issuer's public API.

## License

MIT
