# GLOSSARY

Canonical terminology for the Tarkov Weapon Mod Optimizer domain model.

### Physical Slot
A physical attachment point on a weapon or mod that can accept compatible components. Each physical slot holds at most one installed item at any given time. Identified globally by upstream 24-character hexadecimal MongoDB ObjectIds (`slot.id`).

### Multi-Copy Placement
The physical installation of multiple identical item IDs into distinct physical slots on the same weapon (e.g. dual AK-74 bakelite pistol grips on a PKP/PKM with PT-2 stock, dual KAC URX rail panels, or multiple identical flashlights). Statistics are additive across all occupied placement instances.

### Containing Preset
A pre-assembled weapon configuration sold by traders that includes a receiver and pre-attached mods. When selected as the base, included components are acquired at zero marginal cost. A containing preset provides free components but never forces a preset purchase when a part can be legally supplied via standalone purchase or owned stash inventory.

### Preset Stripping
The removal of unused pre-installed components from a purchased preset base at zero liquidation value (₽0 spend, ₽0 resale credit) without penalty.

### Owned Item (Stash Inventory)
A component already in the player's personal inventory (`owned_items`), supplied at zero out-of-pocket cash expenditure (`buy_i = 0`). Owned items do not consume the `max_price` cash budget. For unpurchasable or trader-locked items, stash quantity strictly caps the maximum number of copies that can be installed on the weapon.

### Unpurchasable / Found-in-Raid (FiR) Item
An item with no available trader or flea market purchase offers (`purchasable: false` or locked by trader loyalty level). Such items can only be installed if supplied by a containing preset or an owned inventory stash. Total installations across all slots cannot exceed available free inventory ($N_{\text{owned}} + N_{\text{preset}}$).

### Out-of-Pocket Expenditure
Actual cash rubles spent to traders or the flea market to acquire the base and unowned components. The hard budget constraint `max_price` applies strictly to out-of-pocket expenditure.

### Required Slot
A physical slot marked as mandatory (`required: true`) for weapon functionality (e.g. barrel, upper receiver, gas block). If any reachable required slot cannot be filled by an accessible, legal component, the configuration is mathematically and physically infeasible.
