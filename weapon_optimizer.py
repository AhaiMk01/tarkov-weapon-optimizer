"""
Tarkov Weapon Mod Optimizer
Uses BFS to build a compatibility map and CP-SAT solver for optimization.

The optimizer uses weapon defaultPreset as the baseline:
- Base stats (ergonomics, recoil) come from defaultErgonomics/defaultRecoilVertical
- These represent the weapon WITH its default preset configuration
- The optimizer finds the best mod configuration from this baseline
- UI displays the defaultPreset image and included items
"""

import requests
from collections import deque
from ortools.sat.python import cp_model

API_URL = "https://api.tarkov.dev/graphql"


def run_query(query, variables=None):
    """Execute a GraphQL query against the Tarkov API."""
    resp = requests.post(API_URL, json={"query": query, "variables": variables or {}}, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data:
        raise RuntimeError(data["errors"])
    return data["data"]


# Query to fetch all guns with their slots
GUNS_QUERY = """
query AllGuns {
  itemsByType(type: gun) {
    id
    basePrice
    avg24hPrice
    buyFor {
      currency
      priceRUB
      source
      vendor {
        name
        normalizedName
        ... on TraderOffer {
          minTraderLevel
          buyLimit
        }
        ... on FleaMarket {
          foundInRaidRequired
        }
      }
    }
    accuracyModifier
    conflictingSlotIds
    ergonomicsModifier
    recoilModifier
    name
    normalizedName
    shortName
    weight
    width
    height
    image8xLink
    image512pxLink
    imageLink
    iconLinkFallback
    iconLink
    properties {
      ... on ItemPropertiesWeapon {
        caliber
        effectiveDistance
        fireRate
        ergonomics
        defaultErgonomics
        recoilVertical
        recoilHorizontal
        defaultRecoilVertical
        defaultRecoilHorizontal
        presets {
          id
          name
          shortName
          baseImageLink
          gridImageLinkFallback
          gridImageLink
          imageLink
          image8xLink
          image512pxLink
          imageLinkFallback
          inspectImageLink
          containsItems {
            item {
              id
            }
          }
          buyFor {
            source
            vendor {
              name
              normalizedName
              ... on TraderOffer {
                minTraderLevel
                buyLimit
              }
              ... on FleaMarket {
                foundInRaidRequired
                enabled
              }
            }
            priceRUB
            price
          }
        }
        slots {
          id
          name
          nameId
          required
          filters {
            allowedItems {
              id
            }
          }
        }
        defaultPreset {
          baseImageLink
          gridImageLinkFallback
          gridImageLink
          iconLinkFallback
          iconLink
          image512pxLink
          image8xLink
          imageLink
          imageLinkFallback
          inspectImageLink
        }
      }
    }
  }
}
"""

# Query to fetch all mods with their slots (for nested attachments)
# Note: Properties vary by mod type, so we query multiple fragment types
MODS_QUERY = """
query AllMods {
  itemsByType(type: mods) {
    id
    basePrice
    avg24hPrice
    buyFor {
      currency
      priceRUB
      source
      vendor {
        name
        normalizedName
        ... on TraderOffer {
          minTraderLevel
          buyLimit
        }
        ... on FleaMarket {
          foundInRaidRequired
        }
      }
    }
    accuracyModifier
    ergonomicsModifier
    recoilModifier
    name
    normalizedName
    shortName
    weight
    width
    height
    image8xLink
    image512pxLink
    imageLink
    iconLinkFallback
    iconLink
    conflictingSlotIds
    conflictingItems {
      id
    }
    properties {
      ... on ItemPropertiesWeaponMod {
        ergonomics
        recoilModifier
        slots {
          id
          name
          nameId
          required
          filters {
            allowedItems {
              id
            }
          }
        }
      }
      ... on ItemPropertiesBarrel {
        ergonomics
        recoilModifier
        slots {
          id
          name
          nameId
          required
          filters {
            allowedItems {
              id
            }
          }
        }
      }
      ... on ItemPropertiesMagazine {
        ergonomics
        recoilModifier
      }
      ... on ItemPropertiesScope {
        ergonomics
        recoilModifier
      }
    }
  }
}
"""


def fetch_all_data():
    """Fetch all guns and mods from the API."""
    print("Fetching guns from API...")
    guns_data = run_query(GUNS_QUERY)
    print(f"  Found {len(guns_data['itemsByType'])} guns")

    print("Fetching mods from API...")
    mods_data = run_query(MODS_QUERY)
    print(f"  Found {len(mods_data['itemsByType'])} mods")

    return guns_data["itemsByType"], mods_data["itemsByType"]


def has_valid_price(item):
    """Check if an item has at least one valid buyFor offer with price > 0."""
    buy_for = item.get("buyFor", []) or []
    for offer in buy_for:
        if isinstance(offer, dict) and (offer.get("priceRUB") or 0) > 0:
            return True
    return False


def build_item_lookup(guns, mods):
    """Build a dictionary for O(1) item lookup by ID.

    Note: Mods without valid market prices are excluded.
    """
    lookup = {}

    # Add guns
    for gun in guns:
        lookup[gun["id"]] = {
            "type": "gun",
            "data": gun,
            "slots": extract_slots(gun),
            "stats": extract_gun_stats(gun),
            "presets": extract_all_presets(gun),  # List of all presets
        }

    # Add mods (only those with valid prices)
    for mod in mods:
        if not has_valid_price(mod):
            continue  # Skip mods without valid market price
        lookup[mod["id"]] = {
            "type": "mod",
            "data": mod,
            "slots": extract_slots_from_mod(mod),
            "stats": extract_mod_stats(mod),
            "conflicting_items": extract_conflicting_items(mod),
            "conflicting_slot_ids": mod.get("conflictingSlotIds", []) or [],
        }

    return lookup


def extract_conflicting_items(item):
    """Extract list of conflicting item IDs from an item."""
    conflicts = item.get("conflictingItems", [])
    if conflicts:
        return [c["id"] for c in conflicts if isinstance(c, dict) and "id" in c]
    return []


def extract_slots(gun):
    """Extract slot information from a gun."""
    slots = []
    props = gun.get("properties")
    if props and props.get("slots"):
        for slot in props["slots"]:
            allowed_ids = []
            # filters is a dict with allowedItems key, not a list
            filters = slot.get("filters")
            if filters and isinstance(filters, dict):
                allowed_items = filters.get("allowedItems", [])
                for item in allowed_items:
                    if isinstance(item, dict):
                        allowed_ids.append(item["id"])
                    elif isinstance(item, str):
                        allowed_ids.append(item)
            slots.append(
                {
                    "id": slot["id"],
                    "name": slot["name"],
                    "nameId": slot["nameId"],
                    "required": slot.get("required", False),
                    "allowedItems": allowed_ids,
                }
            )
    return slots


def extract_slots_from_mod(mod):
    """Extract slot information from a mod."""
    slots = []
    props = mod.get("properties")
    if props and props.get("slots"):
        for slot in props["slots"]:
            allowed_ids = []
            # filters is a dict with allowedItems key, not a list
            filters = slot.get("filters")
            if filters and isinstance(filters, dict):
                allowed_items = filters.get("allowedItems", [])
                for item in allowed_items:
                    if isinstance(item, dict):
                        allowed_ids.append(item["id"])
                    elif isinstance(item, str):
                        allowed_ids.append(item)
            slots.append(
                {
                    "id": slot["id"],
                    "name": slot["name"],
                    "nameId": slot["nameId"],
                    "required": slot.get("required", False),
                    "allowedItems": allowed_ids,
                }
            )
    return slots


def extract_all_presets(gun):
    """Extract all preset information from a gun.

    Returns a list of PURCHASABLE presets (price > 0), each containing:
    - id: preset identifier
    - name: preset display name
    - items: list of item IDs in this preset
    - image: preset image URL
    - price: total preset price (bundle price, TRADER ONLY)
    - price_source: where to buy the preset (trader name)

    Note: Filters out:
    - Presets with price = 0 (unavailable/event-only items)
    - Flea market offers (only trader prices are used)
    """
    props = gun.get("properties", {}) or {}
    presets_data = props.get("presets", []) or []

    if not presets_data:
        return []

    presets = []
    for preset in presets_data:
        if not isinstance(preset, dict):
            continue

        # Extract items from containsItems
        preset_items = []
        contains_items = preset.get("containsItems", []) or []
        for contained in contains_items:
            if isinstance(contained, dict) and "item" in contained:
                item = contained["item"]
                if isinstance(item, dict) and "id" in item:
                    preset_items.append(item["id"])

        # Get image (prefer high-res images)
        preset_image = (
            preset.get("image512pxLink")
            or preset.get("image8xLink")
            or preset.get("imageLink")
            or preset.get("gridImageLink")
            or preset.get("baseImageLink")
        )

        # Get lowest price for the preset (TRADER ONLY, exclude flea market)
        buy_for = preset.get("buyFor", []) or []
        lowest_price = 0
        price_source = "basePrice"
        if buy_for:
            # Filter out flea market offers - only use trader prices
            trader_offers = [offer for offer in buy_for if isinstance(offer, dict) and offer.get("source") != "fleaMarket"]
            if trader_offers:
                min_offer = min(trader_offers, key=lambda x: x.get("priceRUB", float("inf")))
                lowest_price = min_offer.get("priceRUB", 0) or 0
                price_source = min_offer.get("source", "market") or "market"

        # Fallback to basePrice if no trader offers available (quest-locked or barter-only presets)
        if lowest_price == 0:
            base_price = preset.get("basePrice", 0) or 0
            if base_price > 0:
                lowest_price = base_price
                price_source = "basePrice"

        # Only include presets that can actually be purchased (price > 0)
        if lowest_price > 0:
            presets.append(
                {
                    "id": preset.get("id", ""),
                    "name": preset.get("name", "") or preset.get("shortName", "Unknown"),
                    "items": preset_items,
                    "image": preset_image,
                    "price": lowest_price,
                    "price_source": price_source,
                }
            )

    return presets


def extract_gun_stats(gun):
    """Extract and normalize stats from a gun.

    Uses NAKED weapon stats (no attachments):
    - ergonomics: base weapon ergonomics without any mods
    - recoilVertical/recoilHorizontal: base recoil without any mods

    The defaultErgonomics/defaultRecoil* values include the default preset,
    so we explicitly use the non-default values for naked stats.

    Also extracts the defaultPreset grid image for display purposes.
    """
    props = gun.get("properties", {}) or {}

    # Get lowest buyFor price (TRADER ONLY, exclude flea market) - this is for the naked weapon
    buy_for = gun.get("buyFor", []) or []
    lowest_price = 0
    price_source = "basePrice"
    if buy_for:
        # Filter out flea market offers - only use trader prices
        trader_offers = [offer for offer in buy_for if isinstance(offer, dict) and offer.get("source") != "fleaMarket"]
        if trader_offers:
            min_offer = min(trader_offers, key=lambda x: x.get("priceRUB", float("inf")))
            lowest_price = min_offer.get("priceRUB", 0) or 0
            price_source = min_offer.get("source", "market") or "market"

    # If naked gun has no trader offers, set prohibitively high price
    # This forces optimizer to use presets instead of building from naked gun
    if lowest_price == 0:
        # Check if there are any purchasable presets
        presets_data = props.get("presets", []) or []
        has_preset = False
        for preset in presets_data:
            if not isinstance(preset, dict):
                continue
            preset_buy_for = preset.get("buyFor", []) or []
            preset_trader_offers = [
                offer for offer in preset_buy_for
                if isinstance(offer, dict) and offer.get("source") != "fleaMarket"
            ]
            if preset_trader_offers:
                has_preset = True
                break

        if has_preset:
            # Naked gun not purchasable, but presets exist
            # Set very high price to discourage naked gun builds
            lowest_price = 999999999  # Prohibitively expensive
            price_source = "not_available"
        else:
            # No presets either, fall back to basePrice
            base_price = gun.get("basePrice", 0) or 0
            if base_price > 0:
                lowest_price = base_price
                price_source = "basePrice"

    # Get defaultPreset grid image
    default_preset = props.get("defaultPreset", {}) or {}
    default_preset_image = (
        default_preset.get("gridImageLink")
        or default_preset.get("gridImageLinkFallback")
        or default_preset.get("image512pxLink")
        or default_preset.get("image8xLink")
        or default_preset.get("imageLink")
        or default_preset.get("iconLink")
        or default_preset.get("iconLinkFallback")
    )

    return {
        # Naked weapon stats (without default preset)
        "naked_ergonomics": props.get("ergonomics", 0) or 0,
        "naked_recoil_v": props.get("recoilVertical", 0) or 0,
        "naked_recoil_h": props.get("recoilHorizontal", 0) or 0,
        # Default preset stats (for reference/display)
        "default_ergonomics": props.get("defaultErgonomics", 0) or 0,
        "default_recoil_v": props.get("defaultRecoilVertical", 0) or 0,
        "default_recoil_h": props.get("defaultRecoilHorizontal", 0) or 0,
        # Default preset image (grid image)
        "default_preset_image": default_preset_image,
        # Other stats
        "accuracy_modifier": gun.get("accuracyModifier", 0) or 0,
        "fire_rate": props.get("fireRate", 0) or 0,
        "caliber": props.get("caliber", ""),
        "weight": gun.get("weight", 0) or 0,
        "width": gun.get("width", 0) or 0,
        "height": gun.get("height", 0) or 0,
        # Price info (naked weapon price, not including preset)
        "price": lowest_price,
        "price_source": price_source,
    }


def extract_mod_stats(mod):
    """Extract and normalize stats from a mod.

    Note: Top-level recoilModifier is an integer percentage (e.g., -5 = -5%)
          Properties recoilModifier is a decimal (e.g., -0.05 = -5%)
          We normalize to decimal format for calculations.
    """
    props = mod.get("properties", {}) or {}

    # Get ergonomics (flat value)
    ergo = mod.get("ergonomicsModifier", 0) or 0

    # Get recoil modifier - top level is integer %, props is decimal
    top_recoil = mod.get("recoilModifier", 0) or 0
    props_recoil = props.get("recoilModifier", 0) or 0

    # Normalize: if top_recoil is integer format (e.g., -5), convert to decimal (-0.05)
    if props_recoil != 0:
        recoil_mod = props_recoil  # Already decimal
    elif top_recoil != 0:
        recoil_mod = top_recoil / 100.0  # Convert integer % to decimal
    else:
        recoil_mod = 0

    # Get lowest buyFor price (mods without valid prices are already filtered out)
    buy_for = mod.get("buyFor", []) or []
    lowest_price = 0
    price_source = "market"

    if buy_for:
        # Filter to only valid offers with price > 0
        valid_offers = [
            offer for offer in buy_for
            if isinstance(offer, dict) and (offer.get("priceRUB") or 0) > 0
        ]
        if valid_offers:
            min_offer = min(valid_offers, key=lambda x: x.get("priceRUB", float("inf")))
            lowest_price = min_offer.get("priceRUB", 0)
            price_source = min_offer.get("source", "market") or "market"

    return {
        # Flat ergonomics bonus/penalty
        "ergonomics": ergo,
        # Percentage recoil modifier as decimal (e.g., -0.05 for -5%)
        "recoil_modifier": recoil_mod,
        # Accuracy modifier
        "accuracy_modifier": mod.get("accuracyModifier", 0) or 0,
        # Price for cost optimization (use lowest trader price)
        "price": lowest_price,
        # Price source (trader name or "market")
        "price_source": price_source,
        # Weight
        "weight": mod.get("weight", 0) or 0,
        # Grid size
        "width": mod.get("width", 0) or 0,
        "height": mod.get("height", 0) or 0,
    }


def build_compatibility_map(weapon_id, item_lookup):
    """
    Perform BFS from the weapon to find all reachable mods.
    Returns a dict of reachable items with their slot context.

    Key fix: Each slot has a unique ID per parent item, so we track slot ownership
    to properly handle dependency constraints.
    """
    reachable = {}  # item_id -> {"item": item_data}
    slot_items = {}  # slot_id -> list of item_ids that can go in that slot
    item_to_slots = {}  # item_id -> list of slot_ids it owns
    slot_owner = {}  # slot_id -> item_id that owns this slot (or weapon_id)

    if weapon_id not in item_lookup:
        raise ValueError(f"Weapon {weapon_id} not found in item lookup")

    weapon = item_lookup[weapon_id]
    queue = deque()

    # Start BFS from weapon's slots
    for slot in weapon["slots"]:
        slot_id = slot["id"]
        slot_items[slot_id] = []
        slot_owner[slot_id] = weapon_id  # Weapon owns this slot

        for allowed_id in slot["allowedItems"]:
            if allowed_id in item_lookup:
                queue.append((allowed_id, slot_id))
                slot_items[slot_id].append(allowed_id)

    visited = set()

    while queue:
        item_id, parent_slot_id = queue.popleft()

        if item_id in visited:
            continue
        visited.add(item_id)

        if item_id not in item_lookup:
            continue

        item = item_lookup[item_id]
        reachable[item_id] = {
            "item": item,
        }

        # Track slots owned by this item
        item_to_slots[item_id] = []

        # Explore this item's slots
        for slot in item["slots"]:
            slot_id = slot["id"]
            slot_items[slot_id] = []
            slot_owner[slot_id] = item_id  # This item owns this slot
            item_to_slots[item_id].append(slot_id)

            for allowed_id in slot["allowedItems"]:
                if allowed_id in item_lookup and allowed_id not in visited:
                    queue.append((allowed_id, slot_id))
                    slot_items[slot_id].append(allowed_id)

    return {
        "reachable_items": reachable,
        "slot_items": slot_items,
        "item_to_slots": item_to_slots,
        "slot_owner": slot_owner,  # Maps slot_id -> owner item_id
    }


def calculate_total_stats(weapon_stats, selected_mods, item_lookup):
    """
    Calculate total weapon stats with selected mods.

    Stats are calculated from NAKED weapon + selected mods:
    - Ergonomics: naked + sum(mod ergonomics)  [flat addition]
    - Recoil: naked * (1 + sum(mod recoil_modifiers))  [percentage]
    - Weight: naked + sum(mod weights)  [flat addition]
    """
    total_ergo = weapon_stats["naked_ergonomics"]
    total_recoil_mod = 0.0
    total_price = 0
    total_weight = weapon_stats.get("weight", 0)  # Include base weapon weight

    for mod_id in selected_mods:
        if mod_id in item_lookup:
            stats = item_lookup[mod_id]["stats"]
            total_ergo += stats.get("ergonomics", 0)
            total_recoil_mod += stats.get("recoil_modifier", 0)
            total_price += stats.get("price", 0)
            total_weight += stats.get("weight", 0)

    # Apply recoil modifier to naked recoil
    recoil_multiplier = 1 + total_recoil_mod
    final_recoil_v = weapon_stats["naked_recoil_v"] * recoil_multiplier
    final_recoil_h = weapon_stats["naked_recoil_h"] * recoil_multiplier

    return {
        "ergonomics": total_ergo,
        "recoil_vertical": final_recoil_v,
        "recoil_horizontal": final_recoil_h,
        "recoil_multiplier": recoil_multiplier,
        "total_price": total_price,
        "total_weight": total_weight,
    }


def explore_pareto(
    weapon_id, item_lookup, compatibility_map,
    ignore="price",
    max_price=None,
    min_ergonomics=None,
    max_recoil_v=None,
    steps=10
):
    """
    Explore the Pareto frontier between two dimensions, ignoring the third.

    - ignore="price": Show ergo vs recoil frontier (still respects budget if set)
    - ignore="recoil": Show ergo vs price frontier (still respects max_recoil if set)
    - ignore="ergo": Show recoil vs price frontier (still respects min_ergo if set)

    Args:
        ignore: Which dimension to not optimize for - "price", "recoil", or "ergo"
        max_price: Optional budget constraint (always respected if set)
        min_ergonomics: Optional min ergo constraint (always respected if set)
        max_recoil_v: Optional max recoil constraint (always respected if set)
        steps: Number of points to sample along the frontier

    Returns:
        List of dicts with keys: ergo, recoil_pct, recoil_v, recoil_h, price, ...
    """
    weapon_stats = item_lookup[weapon_id]["stats"]
    naked_recoil_v = weapon_stats.get("naked_recoil_v", 100)

    frontier = []

    # Weight presets for single-objective optimization
    RECOIL_WEIGHTS = {"ergo_weight": 0, "recoil_weight": 1, "price_weight": 0}
    ERGO_WEIGHTS = {"ergo_weight": 1, "recoil_weight": 0, "price_weight": 0}
    PRICE_WEIGHTS = {"ergo_weight": 0, "recoil_weight": 0, "price_weight": 1}

    if ignore == "price":
        # Ergo vs Recoil frontier (vary ergo, optimize recoil)
        # Respects: max_price, max_recoil_v constraints if set
        result_low = optimize_weapon(
            weapon_id, item_lookup, compatibility_map,
            max_price=max_price, max_recoil_v=max_recoil_v,
            **RECOIL_WEIGHTS
        )
        result_high = optimize_weapon(
            weapon_id, item_lookup, compatibility_map,
            max_price=max_price, max_recoil_v=max_recoil_v,
            **ERGO_WEIGHTS
        )

        if result_low["status"] == "infeasible":
            return []

        stats_low = calculate_total_stats(weapon_stats, result_low["selected_items"], item_lookup)
        range_min = int(stats_low["ergonomics"])

        if result_high["status"] != "infeasible":
            stats_high = calculate_total_stats(weapon_stats, result_high["selected_items"], item_lookup)
            range_max = int(stats_high["ergonomics"])
        else:
            range_max = 100

        # Respect min_ergonomics constraint
        if min_ergonomics is not None:
            range_min = max(range_min, min_ergonomics)

        range_min = max(0, range_min)
        range_max = min(100, range_max)

        if range_max <= range_min:
            range_max = range_min + 1

        step_size = (range_max - range_min) / (steps - 1) if steps > 1 else 0

        for i in range(steps):
            target = int(range_min + i * step_size)
            result = optimize_weapon(
                weapon_id, item_lookup, compatibility_map,
                max_price=max_price, min_ergonomics=target, max_recoil_v=max_recoil_v,
                **RECOIL_WEIGHTS
            )
            if result["status"] != "infeasible":
                stats = calculate_total_stats(weapon_stats, result["selected_items"], item_lookup)
                frontier.append(_build_frontier_point(stats, result))

    elif ignore == "recoil":
        # Ergo vs Price frontier (vary ergo, optimize price)
        # Respects: max_price, max_recoil_v constraints if set
        result_low = optimize_weapon(
            weapon_id, item_lookup, compatibility_map,
            max_price=max_price, max_recoil_v=max_recoil_v,
            **PRICE_WEIGHTS
        )
        result_high = optimize_weapon(
            weapon_id, item_lookup, compatibility_map,
            max_price=max_price, max_recoil_v=max_recoil_v,
            **ERGO_WEIGHTS
        )

        if result_low["status"] == "infeasible":
            return []

        stats_low = calculate_total_stats(weapon_stats, result_low["selected_items"], item_lookup)
        range_min = int(stats_low["ergonomics"])

        if result_high["status"] != "infeasible":
            stats_high = calculate_total_stats(weapon_stats, result_high["selected_items"], item_lookup)
            range_max = int(stats_high["ergonomics"])
        else:
            range_max = 100

        # Respect min_ergonomics constraint
        if min_ergonomics is not None:
            range_min = max(range_min, min_ergonomics)

        range_min = max(0, range_min)
        range_max = min(100, range_max)

        if range_max <= range_min:
            range_max = range_min + 1

        step_size = (range_max - range_min) / (steps - 1) if steps > 1 else 0

        for i in range(steps):
            target = int(range_min + i * step_size)
            result = optimize_weapon(
                weapon_id, item_lookup, compatibility_map,
                max_price=max_price, min_ergonomics=target, max_recoil_v=max_recoil_v,
                **PRICE_WEIGHTS
            )
            if result["status"] != "infeasible":
                stats = calculate_total_stats(weapon_stats, result["selected_items"], item_lookup)
                frontier.append(_build_frontier_point(stats, result))

    elif ignore == "ergo":
        # Recoil vs Price frontier (vary recoil, optimize price)
        # Respects: max_price, min_ergonomics constraints if set
        result_low = optimize_weapon(
            weapon_id, item_lookup, compatibility_map,
            max_price=max_price, min_ergonomics=min_ergonomics,
            **RECOIL_WEIGHTS
        )
        result_high = optimize_weapon(
            weapon_id, item_lookup, compatibility_map,
            max_price=max_price, min_ergonomics=min_ergonomics,
            **PRICE_WEIGHTS
        )

        if result_low["status"] == "infeasible":
            return []

        stats_low = calculate_total_stats(weapon_stats, result_low["selected_items"], item_lookup)
        range_min = stats_low["recoil_vertical"]

        if result_high["status"] != "infeasible":
            stats_high = calculate_total_stats(weapon_stats, result_high["selected_items"], item_lookup)
            range_max = stats_high["recoil_vertical"]
        else:
            range_max = naked_recoil_v

        # Respect max_recoil_v constraint
        if max_recoil_v is not None:
            range_max = min(range_max, max_recoil_v)

        if range_max <= range_min:
            range_max = range_min + 1

        step_size = (range_max - range_min) / (steps - 1) if steps > 1 else 0

        for i in range(steps):
            target = range_min + i * step_size
            result = optimize_weapon(
                weapon_id, item_lookup, compatibility_map,
                max_price=max_price, min_ergonomics=min_ergonomics, max_recoil_v=target,
                **PRICE_WEIGHTS
            )
            if result["status"] != "infeasible":
                stats = calculate_total_stats(weapon_stats, result["selected_items"], item_lookup)
                frontier.append(_build_frontier_point(stats, result))

    # Remove duplicates while preserving order
    seen = set()
    unique_frontier = []
    for point in frontier:
        key = (point["ergo"], point["recoil_v"], point["price"])
        if key not in seen:
            seen.add(key)
            unique_frontier.append(point)

    return unique_frontier


def _build_frontier_point(stats, result):
    """Helper to build a frontier point dict."""
    return {
        "ergo": int(stats["ergonomics"]),
        "recoil_pct": round((stats["recoil_multiplier"] - 1) * 100, 1),
        "recoil_v": round(stats["recoil_vertical"], 1),
        "recoil_h": round(stats["recoil_horizontal"], 1),
        "price": int(stats["total_price"]),
        "selected_items": result["selected_items"],
        "selected_preset": result.get("selected_preset"),
        "status": result["status"],
    }


def optimize_weapon(
    weapon_id, item_lookup, compatibility_map,
    max_price=None, min_ergonomics=None, max_recoil_v=None,
    ergo_weight=1.0, recoil_weight=1.0, price_weight=0.0
):
    """
    Use CP-SAT solver to find optimal mod configuration.

    Args:
        max_price: Optional budget constraint (total build cost)
        min_ergonomics: Optional minimum final ergonomics (e.g., 50 means final ergo >= 50)
        max_recoil_v: Optional maximum final vertical recoil (e.g., 70 means final recoil <= 70)
        ergo_weight: Weight for ergonomics in objective (higher = prioritize ergo)
        recoil_weight: Weight for recoil reduction in objective (higher = prioritize low recoil)
        price_weight: Weight for price in objective (higher = prioritize low cost)

    Constraints:
    - Mutex: At most one item per slot
    - Dependency: Child item requires parent item
    - Conflicts: Items with conflictingItems can't both be selected
    - Required: API-marked required slots must have exactly one item
    """
    weapon = item_lookup[weapon_id]

    reachable = compatibility_map["reachable_items"]
    slot_items = compatibility_map["slot_items"]
    slot_owner = compatibility_map["slot_owner"]

    model = cp_model.CpModel()

    # Create boolean variables for each reachable item
    item_vars = {}
    for item_id in reachable:
        item_vars[item_id] = model.NewBoolVar(f"item_{item_id}")

    # Create boolean variables for each preset
    presets = weapon.get("presets", [])
    preset_vars = {}
    preset_items_map = {}  # preset_id -> set of item_ids
    for i, preset in enumerate(presets):
        preset_id = preset.get("id", f"preset_{i}")
        preset_vars[preset_id] = model.NewBoolVar(f"preset_{preset_id}")
        preset_items_map[preset_id] = set(preset.get("items", []))

    # Constraint 0: At most ONE preset can be selected
    if preset_vars:
        model.Add(sum(preset_vars.values()) <= 1)

    # Constraint 1: Mutex - at most one item per slot
    for slot_id, items in slot_items.items():
        valid_items = [item_vars[i] for i in items if i in item_vars]
        if valid_items:
            model.Add(sum(valid_items) <= 1)

    # Constraint 2: Dependency - if an item is selected, at least one of its valid parents must be selected
    # Build a map: item_id -> list of possible parent slot owners (not including weapon)
    item_parents = {}  # item_id -> set of parent_ids
    for slot_id, items in slot_items.items():
        owner_id = slot_owner.get(slot_id)
        if owner_id and owner_id != weapon_id and owner_id in item_vars:
            for item_id in items:
                if item_id in item_vars:
                    if item_id not in item_parents:
                        item_parents[item_id] = set()
                    item_parents[item_id].add(owner_id)

    # For each item with parent dependencies, add constraint: item <= sum(parents)
    # This means: if item is selected, at least one parent must be selected
    for item_id, parents in item_parents.items():
        parent_vars = [item_vars[p] for p in parents if p in item_vars]
        if parent_vars:
            # item can only be selected if at least one parent is selected
            model.Add(item_vars[item_id] <= sum(parent_vars))

    # Constraint 3: Conflicting items - can't select both
    conflict_pairs_added = set()
    for item_id in reachable:
        if item_id not in item_lookup:
            continue
        item_data = item_lookup[item_id]
        conflicting = item_data.get("conflicting_items", [])
        for conflict_id in conflicting:
            if conflict_id in item_vars:
                # Create a unique key for this pair to avoid duplicates
                pair = tuple(sorted([item_id, conflict_id]))
                if pair not in conflict_pairs_added:
                    conflict_pairs_added.add(pair)
                    # Can't select both items
                    model.Add(item_vars[item_id] + item_vars[conflict_id] <= 1)

    # Constraint 4: Required slots
    # 4a: Weapon's required slots - always must have exactly one item
    for slot in weapon["slots"]:
        if slot.get("required", False):
            slot_id = slot["id"]
            items_in_slot = [i for i in slot_items.get(slot_id, []) if i in item_vars]
            if items_in_slot:
                model.Add(sum(item_vars[i] for i in items_in_slot) == 1)

    # 4b: Mod's required slots - if mod is selected, its required slots must be filled
    for owner_id, slot_ids in compatibility_map["item_to_slots"].items():
        if owner_id not in item_lookup or owner_id not in item_vars:
            continue
        owner_data = item_lookup[owner_id]
        for slot in owner_data.get("slots", []):
            slot_id = slot["id"]
            if slot.get("required", False):
                items_in_slot = [i for i in slot_items.get(slot_id, []) if i in item_vars]
                if items_in_slot:
                    # If owner is selected, slot must have at least one item
                    model.Add(sum(item_vars[i] for i in items_in_slot) >= 1).OnlyEnforceIf(item_vars[owner_id])

    # Build item-to-presets mapping for price calculation
    item_to_presets = {}  # item_id -> list of preset_ids containing this item
    for preset_id, item_set in preset_items_map.items():
        for item_id in item_set:
            if item_id not in item_to_presets:
                item_to_presets[item_id] = []
            item_to_presets[item_id].append(preset_id)

    # Optional: Max price constraint
    if max_price is not None:
        price_terms = []

        # Add naked gun price (only if no preset is selected)
        naked_gun_price = int(weapon["stats"].get("price", 0))
        if preset_vars and naked_gun_price > 0:
            # Create a variable: any_preset_selected = 1 if any preset is selected
            any_preset_selected_var = model.NewBoolVar("any_preset_selected")
            if preset_vars:
                model.AddMaxEquality(any_preset_selected_var, list(preset_vars.values()))

            # no_preset_selected = 1 - any_preset_selected
            no_preset_selected_var = model.NewBoolVar("no_preset_selected")
            model.Add(no_preset_selected_var == 1 - any_preset_selected_var)

            # Add naked gun price only if no preset is selected
            price_terms.append(naked_gun_price * no_preset_selected_var)
        elif naked_gun_price > 0:
            # No presets available, always add naked gun price
            price_terms.append(naked_gun_price)

        # Add preset prices
        for i, preset in enumerate(presets):
            preset_id = preset.get("id", f"preset_{i}")
            if preset_id in preset_vars:
                preset_price = int(preset.get("price", 0))
                price_terms.append(preset_price * preset_vars[preset_id])

        # Add individual mod prices (only if not covered by a selected preset)
        for item_id in reachable:
            stats = item_lookup[item_id]["stats"]
            item_price = int(stats.get("price", 0))

            containing_presets = item_to_presets.get(item_id, [])
            if not containing_presets:
                # Item not in any preset - always count if selected
                if item_price > 0:
                    price_terms.append(item_price * item_vars[item_id])
            else:
                # Item IS in one or more presets
                # Count individual price ONLY if item is selected AND no containing preset is selected

                # Create a boolean variable to represent whether any containing preset is selected
                any_preset_selected = model.NewBoolVar(f"any_preset_{item_id}")
                containing_preset_vars = [preset_vars[pid] for pid in containing_presets if pid in preset_vars]

                if containing_preset_vars:
                    # any_preset_selected = 1 IFF at least one containing preset is selected
                    model.AddMaxEquality(any_preset_selected, containing_preset_vars)

                    # should_count = item_selected AND NOT any_preset_selected
                    # We'll count the price if item is selected and no preset is selected
                    should_count = model.NewBoolVar(f"count_price_{item_id}")

                    # should_count can only be 1 if item is selected
                    model.Add(should_count <= item_vars[item_id])
                    # should_count can only be 1 if no preset is selected
                    model.Add(should_count <= 1 - any_preset_selected)
                    # If item selected AND no preset, should_count must be 1 (to properly count price)
                    model.Add(should_count >= item_vars[item_id] + (1 - any_preset_selected) - 1)

                    if item_price > 0:
                        price_terms.append(item_price * should_count)
                else:
                    # No containing presets in preset_vars - treat as normal item
                    if item_price > 0:
                        price_terms.append(item_price * item_vars[item_id])

        if price_terms:
            model.Add(sum(price_terms) <= max_price)

    # Scale factors to handle decimals (multiply by 1000 for precision)
    SCALE = 1000

    # Get weapon base stats
    weapon_naked_ergo = weapon["stats"].get("naked_ergonomics", 0)

    # === ERGONOMICS VARIABLE ===
    ergo_terms = []
    for item_id in reachable:
        stats = item_lookup[item_id]["stats"]
        ergo = int(stats.get("ergonomics", 0))
        ergo_terms.append(ergo * item_vars[item_id])

    # Total ergo = naked + sum of mod ergonomics
    total_ergo_var = model.NewIntVar(-200, 300, "total_ergo")
    model.Add(total_ergo_var == weapon_naked_ergo + sum(ergo_terms))

    # Capped ergo for objective (game caps at 0-100)
    ergo_capped_at_100 = model.NewIntVar(-200, 100, "ergo_capped_at_100")
    model.AddMinEquality(ergo_capped_at_100, [total_ergo_var, model.NewConstant(100)])
    capped_ergo_var = model.NewIntVar(0, 100, "capped_ergo")
    model.AddMaxEquality(capped_ergo_var, [ergo_capped_at_100, model.NewConstant(0)])

    # === RECOIL VARIABLE ===
    recoil_terms = []
    for item_id in reachable:
        stats = item_lookup[item_id]["stats"]
        # Recoil modifier as integer (e.g., -0.05 -> -50)
        recoil = int(stats.get("recoil_modifier", 0) * SCALE)
        recoil_terms.append(recoil * item_vars[item_id])

    # Total recoil bonus (negative = reduction)
    total_recoil_var = model.NewIntVar(-1000, 500, "total_recoil")
    model.Add(total_recoil_var == sum(recoil_terms))

    # === OPTIONAL CONSTRAINTS ===
    # Minimum ergonomics constraint
    if min_ergonomics is not None:
        model.Add(total_ergo_var >= min_ergonomics)

    # Maximum final vertical recoil constraint
    # final_recoil_v = naked_recoil_v * (1 + total_recoil_var / SCALE)
    # We want: final_recoil_v <= max_recoil_v
    # => total_recoil_var <= SCALE * (max_recoil_v / naked_recoil_v - 1)
    if max_recoil_v is not None:
        naked_recoil_v = weapon["stats"].get("naked_recoil_v", 100)
        max_recoil_modifier = int(SCALE * (max_recoil_v / naked_recoil_v - 1))
        model.Add(total_recoil_var <= max_recoil_modifier)

    # === OBJECTIVE FUNCTION ===
    objective_terms = []

    # Handle non-purchasable naked guns (force preset selection)
    naked_gun_price_raw = weapon["stats"].get("price", 0)
    naked_gun_not_purchasable = naked_gun_price_raw > 100_000_000

    if preset_vars and naked_gun_not_purchasable:
        any_preset_obj_var = model.NewBoolVar("any_preset_obj")
        model.AddMaxEquality(any_preset_obj_var, list(preset_vars.values()))
        no_preset_obj_var = model.NewBoolVar("no_preset_obj")
        model.Add(no_preset_obj_var == 1 - any_preset_obj_var)
        HUGE_PENALTY = 10_000_000
        objective_terms.append(-HUGE_PENALTY * no_preset_obj_var)

    # === COMBINED WEIGHTED OBJECTIVE ===
    # Ergonomics: higher is better (use capped value)
    objective_terms.append(int(ergo_weight * SCALE) * capped_ergo_var)

    # Recoil: more negative is better (negate to maximize reduction)
    objective_terms.append(int(-recoil_weight * SCALE) * total_recoil_var)

    # Price: lower is better (subtract from objective)
    if price_weight > 0:
        # Add preset prices
        for preset_id, preset_var in preset_vars.items():
            preset_info = next((p for p in presets if p.get("id") == preset_id), None)
            if preset_info:
                preset_price = int(preset_info.get("price", 0))
                objective_terms.append(int(-price_weight * preset_price) * preset_var)

        # Add individual item prices
        for item_id in reachable:
            stats = item_lookup[item_id]["stats"]
            item_price = int(stats.get("price", 0))
            objective_terms.append(int(-price_weight * item_price) * item_vars[item_id])

        # Add naked gun price when no preset selected
        if not naked_gun_not_purchasable:
            naked_price = int(naked_gun_price_raw)
            if preset_vars:
                any_preset_var = model.NewBoolVar("any_preset_price")
                model.AddMaxEquality(any_preset_var, list(preset_vars.values()))
                no_preset_var = model.NewBoolVar("no_preset_price")
                model.Add(no_preset_var == 1 - any_preset_var)
                objective_terms.append(int(-price_weight * naked_price) * no_preset_var)
            else:
                objective_terms.append(int(-price_weight * naked_price))

    model.Maximize(sum(objective_terms))

    # Solve
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 30.0
    status = solver.Solve(model)

    if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
        selected = []
        for item_id, var in item_vars.items():
            if solver.Value(var) == 1:
                selected.append(item_id)

        # Check which preset was selected (if any)
        selected_preset = None
        for preset_id, var in preset_vars.items():
            if solver.Value(var) == 1:
                selected_preset = preset_id
                break

        return {
            "status": "optimal" if status == cp_model.OPTIMAL else "feasible",
            "selected_items": selected,
            "selected_preset": selected_preset,
            "objective_value": solver.ObjectiveValue(),
        }
    else:
        return {
            "status": "infeasible",
            "selected_items": [],
            "selected_preset": None,
            "objective_value": 0,
        }


def print_build(weapon_id, selected_items, item_lookup, weapon_stats):
    """Pretty print the optimized build."""
    print("\n" + "=" * 60)
    weapon = item_lookup[weapon_id]
    print(f"WEAPON: {weapon['data']['name']}")
    print(f"Caliber: {weapon_stats['caliber']}")
    print(f"Fire Rate: {weapon_stats['fire_rate']} RPM")
    print("=" * 60)

    print("\nSELECTED MODS:")
    print("-" * 60)

    total_ergo_bonus = 0
    total_recoil_mod = 0
    total_price = 0

    for item_id in selected_items:
        if item_id in item_lookup:
            item = item_lookup[item_id]
            stats = item["stats"]
            name = item["data"]["name"]
            ergo = stats.get("ergonomics", 0)
            recoil = stats.get("recoil_modifier", 0)
            price = stats.get("price", 0)
            price_source = stats.get("price_source", "market")

            total_ergo_bonus += ergo
            total_recoil_mod += recoil
            total_price += price

            recoil_pct = recoil * 100
            print(f"  {name}")
            print(f"    Ergo: {ergo:+.0f}, Recoil: {recoil_pct:+.1f}%, Price: {price:,} roubles ({price_source})")

    print("\n" + "=" * 60)
    print("FINAL STATS:")
    print("-" * 60)

    final_stats = calculate_total_stats(weapon_stats, selected_items, item_lookup)

    naked_ergo = weapon_stats["naked_ergonomics"]
    naked_v = weapon_stats["naked_recoil_v"]
    naked_h = weapon_stats["naked_recoil_h"]
    mult = final_stats["recoil_multiplier"]
    raw_ergo = final_stats["ergonomics"]
    capped_ergo = max(0, min(100, raw_ergo))
    ergo_note = ""
    if raw_ergo > 100:
        ergo_note = f" (soft cap: {capped_ergo}, +{raw_ergo - 100:.0f} wasted)"
    elif raw_ergo < 0:
        ergo_note = f" (effective: {capped_ergo}, no extra penalty)"
    print(f"  Ergonomics: {naked_ergo} + {total_ergo_bonus:.0f} = {raw_ergo:.0f}{ergo_note}")
    print(f"  Recoil Vertical: {naked_v} x {mult:.2f} = {final_stats['recoil_vertical']:.1f}")
    print(f"  Recoil Horizontal: {naked_h} x {mult:.2f} = {final_stats['recoil_horizontal']:.1f}")
    print(f"  Total Mod Cost: {total_price:,} roubles")
    print(f"  Total Weight Added: {final_stats['total_weight']:.2f} kg")
    print("=" * 60)


def main():
    """Main function to run the optimizer."""
    # Step 1: Fetch all data
    print("=" * 60)
    print("TARKOV WEAPON MOD OPTIMIZER")
    print("=" * 60)

    guns, mods = fetch_all_data()

    # Step 2: Build item lookup dictionary
    print("\nBuilding item lookup table...")
    item_lookup = build_item_lookup(guns, mods)
    print(f"  Total items indexed: {len(item_lookup)}")

    # Step 3: Select the first gun for testing
    test_gun = guns[0]
    weapon_id = test_gun["id"]
    print(f"\nTest weapon: {test_gun['name']}")
    print(f"  ID: {weapon_id}")

    # Step 4: Build compatibility map via BFS
    print("\nBuilding compatibility map (BFS)...")
    compat_map = build_compatibility_map(weapon_id, item_lookup)
    print(f"  Reachable mods: {len(compat_map['reachable_items'])}")
    print(f"  Total slots found: {len(compat_map['slot_items'])}")

    # Show weapon's slots
    weapon = item_lookup[weapon_id]
    print("\nWeapon slots:")
    for slot in weapon["slots"]:
        slot_id = slot["id"]
        num_options = len(compat_map["slot_items"].get(slot_id, []))
        required = "REQUIRED" if slot.get("required") else "optional"
        print(f"  - {slot['nameId']}: {num_options} options ({required})")

    # Step 5: Run optimization
    print("\n" + "=" * 60)
    print("RUNNING OPTIMIZATION...")
    print("=" * 60)

    # Optimize for lowest recoil (no constraints)
    print("\n>>> Optimizing for LOWEST RECOIL <<<")
    result = optimize_weapon(
        weapon_id,
        item_lookup,
        compat_map,
        ergo_weight=0, recoil_weight=1, price_weight=0,
    )

    print(f"Optimization status: {result['status']}")
    print(f"Selected {len(result['selected_items'])} mods")

    if result["selected_items"]:
        print_build(weapon_id, result["selected_items"], item_lookup, weapon["stats"])

    # Optimize for highest ergonomics
    print("\n\n>>> Optimizing for HIGHEST ERGONOMICS <<<")
    result_ergo = optimize_weapon(
        weapon_id,
        item_lookup,
        compat_map,
        ergo_weight=1, recoil_weight=0, price_weight=0,
    )

    print(f"Optimization status: {result_ergo['status']}")
    print(f"Selected {len(result_ergo['selected_items'])} mods")

    if result_ergo["selected_items"]:
        print_build(weapon_id, result_ergo["selected_items"], item_lookup, weapon["stats"])

    # Lowest recoil with minimum ergonomics constraint
    print("\n\n>>> Optimizing for LOWEST RECOIL with MIN ERGO=50 <<<")
    result_balanced = optimize_weapon(
        weapon_id,
        item_lookup,
        compat_map,
        ergo_weight=0, recoil_weight=1, price_weight=0,
        min_ergonomics=50,
    )

    print(f"Optimization status: {result_balanced['status']}")
    print(f"Selected {len(result_balanced['selected_items'])} mods")

    if result_balanced["selected_items"]:
        print_build(weapon_id, result_balanced["selected_items"], item_lookup, weapon["stats"])

    # Budget build
    print("\n\n>>> Optimizing for BUDGET BUILD (max 300,000 roubles) <<<")
    result_budget = optimize_weapon(
        weapon_id,
        item_lookup,
        compat_map,
        ergo_weight=0, recoil_weight=1, price_weight=0,
        max_price=300000,
    )

    print(f"Optimization status: {result_budget['status']}")
    print(f"Selected {len(result_budget['selected_items'])} mods")

    if result_budget["selected_items"]:
        print_build(weapon_id, result_budget["selected_items"], item_lookup, weapon["stats"])


if __name__ == "__main__":
    main()
