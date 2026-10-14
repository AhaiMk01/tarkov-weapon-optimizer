# Amendment: the owned receiver when no base can be bought

Status: **accepted (owner, 2026-10-14).** Records the owner decision of 2026-10-14 on Gunsmith Part 25 (PKP). It amends ADR 0002 (principle 5
and the "Market accessibility" bullet), ADR 0008 principle 4 and ADR 0013 section 4A (first "Emit" bullet), and leaves every other decision of
those ADRs as it is.

## Decision being recorded

Gunsmith Part 25 asks for a PKP build. The PKP has no trader offer, no barter, is banned from the flea market, and none of its three presets
can be bought. Under the old rule ("no accessible base means an impossible base-choice row, never a fabricated free receiver") such a gun can
never be built, so the task was certified infeasible even with no constraint at all. A player who has the gun can still build it.

The owner's rule:

- **When it applies.** A weapon has *no accessible base at all*: the naked receiver has no legal offer, and no preset of this receiver has a
  legal offer, under the request's own market settings (trader levels, flea market, barters and their dogtag filter, player level).
- **What happens.** The naked receiver is treated as owned by the player: it is the only base, its price is 0 and its source is `owned`.
- **When it does not apply.** If any base can be bought (the naked receiver or any preset), nothing changes: there is no fallback, and a
  receiver with no legal offer stays inaccessible.
- **Presets are never assumed owned.** The owned base is always the naked receiver with no preset stock.
- **The stash plays no part.** `owned_items` still never grants a base. The owned receiver does not need the receiver id in the stash and
  does not use up a stash copy of it.
- **Everywhere.** Optimize, Explore, Gunsmith and the MOA floor; Fast and Precise. It is part of the acquisition domain, so every operation
  that prepares a domain sees it.
- **Said plainly.** The result says so: "Uses your own PKP (it can't be bought)" on the base card (locale key `ui.owned_receiver`, with a
  tooltip `ui.owned_receiver_tooltip`). The shopping list, the manifest and the copied text show the gun as "your own" with no price
  (`ui.owned_receiver_short`); it is never a purchase line. The EFTForge export carries the weapon id as before, which is not a purchase.

## Amendment to ADR 0002 (authoritative physical acquisition domain)

- Principle 5 and the "Market accessibility" bullet: "No accessible base means an impossible base-choice row, never a fabricated free
  receiver" now reads: no purchasable base means exactly one base, the player's own naked receiver at price 0. A price-0 receiver is still
  never invented while some base can be bought, and a stored price of 0 is still not an offer.
- The deficit, supply cap and spend rules are unchanged. The owned receiver supplies no component (`q_{b,i} = 0`), and the spend counts 0 for
  it, so `max_price` and the price objective see only the parts.

## Amendment to ADR 0008 (owned items)

- Principle 4 ("owning a weapon receiver ID does not grant a free base gun") stays true of the stash. The owned receiver of this amendment is a
  separate rule about the market, decided without reading `owned_items`.

## Amendment to ADR 0013, section 4A

- "Exactly one accessible naked or preset base. No accessible base means an explicit contradictory base-choice row, not a free fallback" now
  reads: exactly one accessible base; when no base has a legal offer, the base set is the owned naked receiver alone, at price 0. The domain
  contradiction `NO_ACCESSIBLE_BASE` no longer exists; a domain is empty only when a root required slot cannot be filled.
- Acquisition shapes: the published base carries `acquisition: { source: 'offer' | 'owned' }` (`PresetDetail`, `src/api/client.ts`); the
  validator's statistics carry `baseSource: 'offer' | 'owned' | null` next to `basePrice`. The base choice of a build stays
  `{ kind: 'naked' }`; whether it is owned follows from the rule, and the validator recomputes it.

## Where it lives

- Production: `prepareSubproblemDomain` (`src/solver/physical/domain.ts`, base `{ kind: 'naked', owned: true, cheapestPrice: 0 }`), the
  validator (`src/solver/physical/validate.ts`, `baseSource`), the published base (`src/solver/buildDetails.ts`), the UI
  (`UsingPresetCard.tsx`, `shoppingList.ts`, `App.tsx`) and the 16 locale files. Fast and Precise read the domain's bases, so they need no
  rule of their own.
- Reference: interpretation 18 (`frontend/reference/INTERPRETATIONS.md`), implemented on its own in `reference/oracle/acquisition.ts` and
  `reference/oracle/validate.ts`; ledger family 5.
- Proof: `docs/proofs/count-model.md`, section 15.

## Evidence at the time of drafting

- Pinned snapshot, benchmark request (flea on, barters off, traders 4, level 50): 19 guns were certified infeasible, all with no accessible
  base. 17 of them had no other contradiction and become buildable; KS-23M and AK-50 also have an empty root required slot and stay
  infeasible.
- Live JSON API (2026-10-14), flea and barters on, traders 4, level 79: 9 guns with no accessible base in regular (SP-81, Flare, Red, MSGL, PKP,
  Blue, S-Yellow, Firework, AK-50) and 12 in pve (the same 9 plus Mk 43 Mod 1 and two M60E6).
