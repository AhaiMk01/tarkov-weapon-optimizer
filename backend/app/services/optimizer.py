"""
Tarkov Weapon Mod Optimizer Service
Logic refactored from original weapon_optimizer.py for use in FastAPI.
"""

import hashlib
import json
import os
import sys
import time
from collections import deque
from loguru import logger
from ortools.sat.python import cp_model
import requests

# Use relative import for queries within the same package
from .queries import GUNS_QUERY, MODS_QUERY

# Cache configuration
# In a real production app, we might use Redis, but for now we keep file-based cache 
# but point it to a temp dir or a dedicated cache dir.
CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", ".cache")
CACHE_TTL = 3600  # 1 hour
CACHE_VERSION = 7

API_URL = "https://api.tarkov.dev/graphql"

def _get_cache_path(query, variables):
    """Generate a cache file path based on query hash."""
    key = hashlib.md5((query + json.dumps(variables or {}, sort_keys=True)).encode()).hexdigest()
    return os.path.join(CACHE_DIR, f"{key}.json")

def _load_cache(cache_path):
    if not os.path.exists(cache_path):
        return None
    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            cached = json.load(f)
        if cached.get("version") != CACHE_VERSION:
            return None
        if time.time() - cached.get("timestamp", 0) < CACHE_TTL:
            return cached.get("data")
    except Exception:
        pass
    return None

def _save_cache(cache_path, data):
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump({"timestamp": time.time(), "version": CACHE_VERSION, "data": data}, f)

def run_query(query, variables=None, max_retries=3):
    """Execute a GraphQL query against the Tarkov API."""
    cache_path = _get_cache_path(query, variables)
    cached = _load_cache(cache_path)
    if cached:
        return cached

    logger.info("Fetching data from Tarkov.dev API...")
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(
                API_URL,
                json={"query": query, "variables": variables or {}},
                timeout=90,
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
            if "errors" in data:
                raise RuntimeError(data["errors"])
            result = data["data"]
            _save_cache(cache_path, result)
            return result
        except Exception as e:
            logger.warning(f"API Attempt {attempt} failed: {e}")
            if attempt < max_retries:
                time.sleep(2 ** attempt)
    
    raise RuntimeError("Failed to fetch data from API")

def fetch_all_data(lang="en", game_mode="regular"):
    guns_data = run_query(GUNS_QUERY, variables={"lang": lang, "gameMode": game_mode})
    mods_data = run_query(MODS_QUERY, variables={"lang": lang, "gameMode": game_mode})
    return guns_data["items"], mods_data["items"]

# --- Helper Functions (ported directly) ---

def has_valid_price(item):
    buy_for = item.get("buyFor", []) or []
    for offer in buy_for:
        if isinstance(offer, dict) and (offer.get("priceRUB") or 0) > 0:
            return True
    return False

def extract_conflicting_items(item):
    conflicts = item.get("conflictingItems", [])
    if conflicts:
        return [c["id"] for c in conflicts if isinstance(c, dict) and "id" in c]
    return []

def extract_slots(gun):
    slots = []
    props = gun.get("properties")
    if props and props.get("slots"):
        for slot in props["slots"]:
            allowed_ids = []
            filters = slot.get("filters")
            if filters and isinstance(filters, dict):
                allowed_items = filters.get("allowedItems", [])
                for item in allowed_items:
                    if isinstance(item, dict):
                        allowed_ids.append(item["id"])
                    elif isinstance(item, str):
                        allowed_ids.append(item)
            slots.append({
                "id": slot["id"],
                "name": slot["name"],
                "nameId": slot["nameId"],
                "required": slot.get("required", False),
                "allowedItems": allowed_ids,
            })
    return slots

def extract_slots_from_mod(mod):
    slots = []
    props = mod.get("properties")
    if props and props.get("slots"):
        for slot in props["slots"]:
            allowed_ids = []
            filters = slot.get("filters")
            if filters and isinstance(filters, dict):
                allowed_items = filters.get("allowedItems", [])
                for item in allowed_items:
                    if isinstance(item, dict):
                        allowed_ids.append(item["id"])
                    elif isinstance(item, str):
                        allowed_ids.append(item)
            slots.append({
                "id": slot["id"],
                "name": slot["name"],
                "nameId": slot["nameId"],
                "required": slot.get("required", False),
                "allowedItems": allowed_ids,
            })
    return slots

def extract_all_presets(gun, include_unpurchasable=False):
    props = gun.get("properties", {}) or {}
    presets_data = props.get("presets", []) or []

    if not presets_data:
        return []

    presets = []
    for preset in presets_data:
        if not isinstance(preset, dict):
            continue

        preset_items = []
        contains_items = preset.get("containsItems", []) or []
        for contained in contains_items:
            if isinstance(contained, dict) and "item" in contained:
                item = contained["item"]
                if isinstance(item, dict) and "id" in item:
                    preset_items.append(item["id"])

        preset_image = (
            preset.get("image512pxLink") or preset.get("imageLink") or 
            preset.get("image8xLink") or preset.get("gridImageLink") or 
            preset.get("baseImageLink")
        )

        buy_for = preset.get("buyFor", []) or []
        offers = []
        for offer in buy_for:
            if not isinstance(offer, dict): continue
            price = offer.get("priceRUB") or 0
            if price <= 0: continue
            
            source = offer.get("source", "")
            vendor = offer.get("vendor", {}) or {}
            trader_level = None
            if source != "fleaMarket":
                trader_level = vendor.get("minTraderLevel") or 1

            offers.append({
                "price": price,
                "source": source,
                "vendor_name": vendor.get("name", ""),
                "vendor_normalized": vendor.get("normalizedName", ""),
                "trader_level": trader_level,
            })

        offers.sort(key=lambda x: x["price"])
        lowest_price = 0
        price_source = "not_available"
        if offers:
            lowest_price = offers[0]["price"]
            price_source = offers[0]["source"]

        purchasable = lowest_price > 0

        if purchasable or include_unpurchasable:
            presets.append({
                "id": preset.get("id", ""),
                "name": preset.get("name", "") or preset.get("shortName", "Unknown"),
                "items": preset_items,
                "image": preset_image,
                "price": lowest_price,
                "price_source": price_source,
                "offers": offers,
                "purchasable": purchasable,
            })
    return presets

def extract_gun_stats(gun):
    props = gun.get("properties", {}) or {}
    buy_for = gun.get("buyFor", []) or []
    lowest_price = 0
    price_source = "basePrice"
    if buy_for:
        trader_offers = [offer for offer in buy_for if isinstance(offer, dict) and offer.get("source") != "fleaMarket"]
        if trader_offers:
            min_offer = min(trader_offers, key=lambda x: x.get("priceRUB", float("inf")))
            lowest_price = min_offer.get("priceRUB", 0) or 0
            price_source = min_offer.get("source", "market") or "market"

    if lowest_price == 0:
        presets_data = props.get("presets", []) or []
        has_preset = False
        for preset in presets_data:
            if not isinstance(preset, dict): continue
            preset_buy_for = preset.get("buyFor", []) or []
            preset_trader_offers = [
                offer for offer in preset_buy_for
                if isinstance(offer, dict) and offer.get("source") != "fleaMarket"
            ]
            if preset_trader_offers:
                has_preset = True
                break
        
        if has_preset:
            lowest_price = 999999999
            price_source = "not_available"
        else:
            lowest_price = 999999999
            price_source = "not_available"

    default_preset = props.get("defaultPreset", {}) or {}
    default_preset_image = (
        default_preset.get("image512pxLink") or default_preset.get("imageLink") or 
        default_preset.get("image8xLink") or default_preset.get("gridImageLink") or 
        default_preset.get("gridImageLinkFallback") or default_preset.get("iconLink") or 
        default_preset.get("iconLinkFallback")
    )

    return {
        "naked_ergonomics": props.get("ergonomics", 0) or 0,
        "naked_recoil_v": props.get("recoilVertical", 0) or 0,
        "naked_recoil_h": props.get("recoilHorizontal", 0) or 0,
        "default_ergonomics": props.get("defaultErgonomics", 0) or 0,
        "default_recoil_v": props.get("defaultRecoilVertical", 0) or 0,
        "default_recoil_h": props.get("defaultRecoilHorizontal", 0) or 0,
        "default_preset_image": default_preset_image,
        "accuracy_modifier": gun.get("accuracyModifier", 0) or 0,
        "fire_rate": props.get("fireRate", 0) or 0,
        "fire_modes": props.get("fireModes", []) or [],
        "caliber": props.get("caliber", ""),
        "weight": gun.get("weight", 0) or 0,
        "width": gun.get("width", 0) or 0,
        "height": gun.get("height", 0) or 0,
        "sighting_range": props.get("sightingRange") or 0,
        "category": gun.get("bsgCategory", {}).get("name", "") if gun.get("bsgCategory") else "",
        "category_id": gun.get("bsgCategory", {}).get("id", "") if gun.get("bsgCategory") else "",
        "camera_snap": props.get("cameraSnap", 0) or 0,
        "center_of_impact": props.get("centerOfImpact", 0) or 0,
        "deviation_max": props.get("deviationMax", 0) or 0,
        "deviation_curve": props.get("deviationCurve", 0) or 0,
        "recoil_angle": props.get("recoilAngle", 0) or 0,
        "recoil_dispersion": props.get("recoilDispersion", 0) or 0,
        "price": lowest_price,
        "price_source": price_source,
    }

def extract_mod_stats(mod):
    props = mod.get("properties", {}) or {}
    ergo = mod.get("ergonomicsModifier", 0) or 0
    top_recoil = mod.get("recoilModifier", 0) or 0
    props_recoil = props.get("recoilModifier", 0) or 0

    if props_recoil != 0:
        recoil_mod = props_recoil
    elif top_recoil != 0:
        recoil_mod = top_recoil / 100.0
    else:
        recoil_mod = 0

    buy_for = mod.get("buyFor", []) or []
    offers = []
    lowest_price = 0
    price_source = "market"

    for offer in buy_for:
        if not isinstance(offer, dict): continue
        price = offer.get("priceRUB") or 0
        if price <= 0: continue

        source = offer.get("source", "")
        vendor = offer.get("vendor", {}) or {}
        trader_level = None
        if source == "fleaMarket":
            trader_level = None
        else:
            trader_level = vendor.get("minTraderLevel") or 1

        offers.append({
            "price": price,
            "source": source,
            "vendor_name": vendor.get("name", ""),
            "vendor_normalized": vendor.get("normalizedName", ""),
            "trader_level": trader_level,
        })

    offers.sort(key=lambda x: x["price"])
    if offers:
        lowest_price = offers[0]["price"]
        price_source = offers[0]["source"]

    return {
        "ergonomics": ergo,
        "recoil_modifier": recoil_mod,
        "accuracy_modifier": mod.get("accuracyModifier", 0) or 0,
        "offers": offers,
        "price": lowest_price,
        "price_source": price_source,
        "weight": mod.get("weight", 0) or 0,
        "width": mod.get("width", 0) or 0,
        "height": mod.get("height", 0) or 0,
        "min_level_flea": mod.get("minLevelForFlea") or 0,
        "capacity": props.get("capacity") or 0,
        "sighting_range": props.get("sightingRange") or 0,
        "category": mod.get("bsgCategory", {}).get("name"),
        "category_id": mod.get("bsgCategory", {}).get("id", "") if mod.get("bsgCategory") else "",
    }

def build_item_lookup(guns, mods):
    logger.info("Building item lookup table...")
    lookup = {}
    for gun in guns:
        lookup[gun["id"]] = {
            "type": "gun",
            "data": gun,
            "slots": extract_slots(gun),
            "stats": extract_gun_stats(gun),
            "presets": extract_all_presets(gun),
            "all_presets": extract_all_presets(gun, include_unpurchasable=True),
        }
    for mod in mods:
        if not has_valid_price(mod): continue
        lookup[mod["id"]] = {
            "type": "mod",
            "data": mod,
            "slots": extract_slots_from_mod(mod),
            "stats": extract_mod_stats(mod),
            "conflicting_items": extract_conflicting_items(mod),
            "conflicting_slot_ids": mod.get("conflictingSlotIds", []) or [],
        }
    return lookup

DEFAULT_TRADER_LEVELS = {
    "prapor": 4, "skier": 4, "peacekeeper": 4, "mechanic": 4, "jaeger": 4,
}

def get_available_price(stats, trader_levels=None, flea_available=True, player_level=None):
    if trader_levels is None:
        trader_levels = DEFAULT_TRADER_LEVELS
    
    min_level_flea = stats.get("min_level_flea", 0)
    offers = stats.get("offers")
    
    if not offers:
        default_price = stats.get("price", 0)
        if default_price > 0 and flea_available:
            if player_level is not None and min_level_flea > player_level:
                return (0, None, False)
            return (default_price, stats.get("price_source", "market"), True)
        return (0, None, False)

    best_price = None
    best_source = None

    for offer in offers:
        price = offer["price"]
        source = offer["source"]
        required_level = offer["trader_level"]
        vendor = offer.get("vendor_normalized", "").lower()

        if source == "fleaMarket":
            if not flea_available: continue
            if player_level is not None and min_level_flea > player_level: continue
        else:
            trader_level = trader_levels.get(vendor, 4)
            if required_level is not None and required_level > trader_level: continue

        if best_price is None or price < best_price:
            best_price = price
            best_source = source

    if best_price is not None:
        return (best_price, best_source, True)
    return (0, None, False)

def build_compatibility_map(weapon_id, item_lookup):
    if weapon_id not in item_lookup:
        raise ValueError(f"Weapon {weapon_id} not found in item lookup")

    reachable = {}
    slot_items = {}
    item_to_slots = {}
    slot_owner = {}
    weapon = item_lookup[weapon_id]
    queue = deque()

    for slot in weapon["slots"]:
        slot_id = slot["id"]
        slot_items[slot_id] = []
        slot_owner[slot_id] = weapon_id
        for allowed_id in slot["allowedItems"]:
            if allowed_id == weapon_id: continue
            if allowed_id in item_lookup:
                queue.append((allowed_id, slot_id))
                slot_items[slot_id].append(allowed_id)

    visited = set()
    while queue:
        item_id, parent_slot_id = queue.popleft()
        if item_id in visited: continue
        visited.add(item_id)
        if item_id not in item_lookup: continue

        item = item_lookup[item_id]
        reachable[item_id] = {"item": item}
        item_to_slots[item_id] = []

        for slot in item["slots"]:
            slot_id = slot["id"]
            slot_items[slot_id] = []
            slot_owner[slot_id] = item_id
            item_to_slots[item_id].append(slot_id)
            for allowed_id in slot["allowedItems"]:
                if allowed_id in item_lookup:
                    slot_items[slot_id].append(allowed_id)
                    if allowed_id not in visited:
                        queue.append((allowed_id, slot_id))

    return {
        "reachable_items": reachable,
        "slot_items": slot_items,
        "item_to_slots": item_to_slots,
        "slot_owner": slot_owner,
    }

def calculate_total_stats(weapon_stats, selected_mods, item_lookup):
    total_ergo = weapon_stats["naked_ergonomics"]
    total_recoil_mod = 0.0
    total_price = 0
    total_weight = weapon_stats.get("weight", 0)

    for mod_id in selected_mods:
        if mod_id in item_lookup:
            stats = item_lookup[mod_id]["stats"]
            total_ergo += stats.get("ergonomics", 0)
            total_recoil_mod += stats.get("recoil_modifier", 0)
            total_price += stats.get("price", 0)
            total_weight += stats.get("weight", 0)

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

def _check_constraints_feasibility(
    weapon, item_lookup, compatibility_map,
    max_price=None, min_ergonomics=None, max_recoil_v=None, max_recoil_sum=None,
    min_mag_capacity=None, min_sighting_range=None, max_weight=None,
    include_items=None, exclude_items=None,
    include_categories=None, exclude_categories=None,
    trader_levels=None, flea_available=True
):
    reasons = []
    available_items = compatibility_map["reachable_items"]

    if include_items:
        for req_id in include_items:
            if req_id not in available_items:
                name = item_lookup.get(req_id, {}).get("data", {}).get("name", req_id)
                reasons.append(f"Required item '{name}' is not compatible with this weapon")

    if include_categories:
        for i, group in enumerate(include_categories):
            group_ids = [cat for cat in group if isinstance(cat, str)]
            if not group_ids: continue
            found = False
            for item_id in available_items:
                stats = item_lookup[item_id]["stats"]
                cat_id = stats.get("category_id", "")
                cat_name = stats.get("category", "")
                # Check both category ID and name for flexibility
                if cat_id in group_ids or cat_name in group_ids:
                    found = True
                    break
            if not found:
                reasons.append(f"No items found for required category group: {group_ids}")

    if min_mag_capacity:
        has_adequate_mag = False
        for item_id in available_items:
            stats = item_lookup[item_id]["stats"]
            if stats.get("capacity", 0) >= min_mag_capacity:
                has_adequate_mag = True
                break
        if not has_adequate_mag:
            reasons.append(f"No magazine with capacity >= {min_mag_capacity} rounds available")

    if min_sighting_range:
        base_sighting = weapon["stats"].get("sighting_range", 0)
        if base_sighting < min_sighting_range:
            has_adequate_sight = False
            for item_id in available_items:
                stats = item_lookup[item_id]["stats"]
                if stats.get("sighting_range", 0) >= min_sighting_range:
                    has_adequate_sight = True
                    break
            if not has_adequate_sight:
                reasons.append(f"No sight with sighting range >= {min_sighting_range}m available")

    if max_weight is not None:
        base_weight = weapon["stats"].get("weight", 0)
        min_mod_weight = 0
        for item_id in available_items:
            stats = item_lookup[item_id]["stats"]
            weight = stats.get("weight", 0)
            if weight > 0 and weight < min_mod_weight or min_mod_weight == 0:
                min_mod_weight = weight
        total_min_weight = base_weight + min_mod_weight
        if total_min_weight > max_weight:
            reasons.append(f"Weight exceeds limit even with lightest mods ({total_min_weight:.2f}kg > {max_weight}kg)")

    return reasons if reasons else None

def optimize_weapon(
    weapon_id, item_lookup, compatibility_map,
    max_price=None, min_ergonomics=None, max_recoil_v=None, max_recoil_sum=None,
    min_mag_capacity=None, min_sighting_range=None, max_weight=None,
    include_items=None, exclude_items=None,
    include_categories=None, exclude_categories=None,
    ergo_weight=1.0, recoil_weight=1.0, price_weight=0.0,
    trader_levels=None, flea_available=True, player_level=None
):
    if trader_levels is None:
        trader_levels = DEFAULT_TRADER_LEVELS

    weapon = item_lookup[weapon_id]
    logger.info(f"Optimization request for {weapon_id}")

    feasibility_reasons = _check_constraints_feasibility(
        weapon, item_lookup, compatibility_map,
        max_price, min_ergonomics, max_recoil_v, max_recoil_sum,
        min_mag_capacity, min_sighting_range, max_weight,
        include_items, exclude_items, include_categories, exclude_categories,
        trader_levels, flea_available
    )
    if feasibility_reasons is not None:
        return {
            "status": "infeasible",
            "reason": "; ".join(feasibility_reasons),
            "selected_items": [],
            "selected_preset": None,
            "objective_value": 0,
        }

    reachable = compatibility_map["reachable_items"]
    slot_items = compatibility_map["slot_items"]
    slot_owner = compatibility_map["slot_owner"]

    presets = weapon.get("presets", [])
    preset_items_map = {}
    item_to_presets = {}
    preset_prices_map = {}
    
    for i, preset in enumerate(presets):
        p_price, p_source, p_avail = get_available_price(
            {"offers": preset.get("offers", []), "price": preset.get("price", 0)},
            trader_levels, flea_available, player_level
        )
        if not p_avail: continue
        preset_id = preset.get("id", f"preset_{i}")
        preset_prices_map[preset_id] = p_price
        items_in_preset = set(preset.get("items", []))
        preset_items_map[preset_id] = items_in_preset
        for item_id in items_in_preset:
            if item_id not in item_to_presets:
                item_to_presets[item_id] = []
            item_to_presets[item_id].append(preset_id)

    available_items = {}
    item_prices = {}
    exclude_items_set = set(exclude_items) if exclude_items else set()
    exclude_categories_set = set(exclude_categories) if exclude_categories else set()

    for item_id in reachable:
        if item_id not in item_lookup: continue
        if item_id in exclude_items_set: continue
        stats = item_lookup[item_id]["stats"]
        category = stats.get("category")
        if category and category in exclude_categories_set: continue

        price, source, is_available = get_available_price(
            stats, trader_levels, flea_available, player_level
        )

        in_preset = item_id in item_to_presets
        default_price = stats.get("price", 0)
        if default_price > 100_000_000:
            if not in_preset: continue
            price = 0
            is_available = False

        if not is_available and not in_preset: continue
        available_items[item_id] = reachable[item_id]
        item_prices[item_id] = (price, source, is_available)

    model = cp_model.CpModel()

    base_vars = {}
    naked_gun_price_raw = weapon["stats"].get("price", 0)
    naked_gun_purchasable = naked_gun_price_raw < 100_000_000
    fallback_base = None

    if naked_gun_purchasable:
        base_vars["naked"] = model.NewBoolVar("base_naked")

    for preset_id in preset_items_map:
        base_vars[preset_id] = model.NewBoolVar(f"base_{preset_id}")

    if base_vars:
        model.Add(sum(base_vars.values()) == 1)
    else:
        all_presets = weapon.get("all_presets", [])
        if all_presets:
            fallback_preset = all_presets[0]
            fallback_preset_id = fallback_preset.get("id", "fallback_preset_0")
            base_vars[fallback_preset_id] = model.NewBoolVar(f"base_{fallback_preset_id}")
            model.Add(base_vars[fallback_preset_id] == 1)
            fallback_items = set(fallback_preset.get("items", []))
            preset_items_map[fallback_preset_id] = fallback_items
            preset_prices_map[fallback_preset_id] = 0
            for item_id in fallback_items:
                if item_id not in item_to_presets: item_to_presets[item_id] = []
                item_to_presets[item_id].append(fallback_preset_id)
                if item_id in reachable and item_id not in available_items:
                    available_items[item_id] = reachable[item_id]
                    item_prices[item_id] = (0, "fallback_preset", False)
            fallback_base = {"type": "preset", "id": fallback_preset_id, "name": fallback_preset.get("name", "Unknown"), "price": 0}
        else:
            base_vars["naked"] = model.NewBoolVar("base_naked")
            model.Add(base_vars["naked"] == 1)
            fallback_base = {"type": "naked", "price": 0}

    x = {}
    for item_id in available_items:
        x[item_id] = model.NewBoolVar(f"x_{item_id}")

    item_only_in_preset = {}
    for item_id in available_items:
        containing_presets = item_to_presets.get(item_id, [])
        is_individually_available = item_prices[item_id][2]
        item_only_in_preset[item_id] = not is_individually_available and bool(containing_presets)

    for item_id in available_items:
        is_individually_available = item_prices[item_id][2]
        containing_presets = [base_vars[pid] for pid in item_to_presets.get(item_id, []) if pid in base_vars]
        if not is_individually_available:
            if containing_presets:
                model.Add(x[item_id] <= sum(containing_presets))
            else:
                model.Add(x[item_id] == 0)

    buy = {}
    for item_id in available_items:
        buy[item_id] = model.NewBoolVar(f"buy_{item_id}")
        containing_presets = [base_vars[pid] for pid in item_to_presets.get(item_id, []) if pid in base_vars]
        if containing_presets:
            any_preset_with_item = model.NewBoolVar(f"preset_has_{item_id}")
            model.AddMaxEquality(any_preset_with_item, containing_presets)
            model.Add(buy[item_id] <= x[item_id])
            model.Add(buy[item_id] <= 1 - any_preset_with_item)
            model.Add(buy[item_id] >= x[item_id] - any_preset_with_item)
        else:
            model.Add(buy[item_id] == x[item_id])

    item_vars = x
    effective_item_vars = x
    preset_vars = {k: v for k, v in base_vars.items() if k != "naked"}

    if include_items:
        for req_id in include_items:
            if req_id in item_vars:
                model.Add(item_vars[req_id] == 1)
            else:
                model.Add(0 == 1)

    if include_categories:
        for group in include_categories:
            group_vars = []
            for req_cat in group:
                for item_id, var in item_vars.items():
                    stats = item_lookup[item_id]["stats"]
                    cat_id = stats.get("category_id", "")
                    cat_name = stats.get("category", "")
                    # Check both category ID and name for flexibility
                    if cat_id == req_cat or cat_name == req_cat:
                        group_vars.append(var)
            if group_vars:
                model.Add(sum(group_vars) >= 1)
            else:
                model.Add(0 == 1)

    for item_id, var in item_vars.items():
        is_avail = item_prices[item_id][2]
        if not is_avail:
            containing = [preset_vars[pid] for pid in item_to_presets.get(item_id, []) if pid in preset_vars]
            if containing:
                model.Add(var <= sum(containing))
            else:
                model.Add(var == 0)

    item_to_valid_slots = {i: [] for i in item_vars}
    for slot_id, items in slot_items.items():
        owner_id = slot_owner.get(slot_id)
        is_base = (owner_id == weapon_id)
        owner_available = is_base or owner_id in item_vars or owner_id in effective_item_vars
        if owner_available:
            for item_id in items:
                if item_id in item_vars:
                    item_to_valid_slots[item_id].append((slot_id, owner_id, is_base))

    placed_in = {}
    items_needing_placement = set()
    for item_id, valid_slots in item_to_valid_slots.items():
        if len(valid_slots) > 1:
            items_needing_placement.add(item_id)
            placed_in[item_id] = {}
            for slot_id, owner_id, is_base in valid_slots:
                placed_in[item_id][slot_id] = model.NewBoolVar(f"placed_{item_id[:8]}_{slot_id[:8]}")

    for item_id in items_needing_placement:
        placement_vars = list(placed_in[item_id].values())
        model.Add(sum(placement_vars) == item_vars[item_id])

    for slot_id, items in slot_items.items():
        slot_placements = []
        for item_id in items:
            if item_id not in x: continue
            if item_id in items_needing_placement:
                if slot_id in placed_in.get(item_id, {}):
                    slot_placements.append(placed_in[item_id][slot_id])
            else:
                valid_slots = item_to_valid_slots.get(item_id, [])
                if any(s[0] == slot_id for s in valid_slots):
                    slot_placements.append(x[item_id])
        if slot_placements:
            model.Add(sum(slot_placements) <= 1)

    item_connected_to_base = {i: False for i in item_vars}
    for item_id, valid_slots in item_to_valid_slots.items():
        if not valid_slots:
            model.Add(item_vars[item_id] == 0)
            continue
        has_base_slot = any(is_base for _, _, is_base in valid_slots)
        if has_base_slot:
            item_connected_to_base[item_id] = True
        
        if item_id in items_needing_placement:
            for slot_id, owner_id, is_base in valid_slots:
                if slot_id not in placed_in[item_id]: continue
                placement_var = placed_in[item_id][slot_id]
                if not is_base:
                    if owner_id in item_vars:
                        model.Add(placement_var <= item_vars[owner_id])
                    elif owner_id in effective_item_vars:
                        model.Add(placement_var <= effective_item_vars[owner_id])
                    else:
                        model.Add(placement_var == 0)
        else:
            if not has_base_slot:
                parent_vars = []
                for slot_id, owner_id, is_base in valid_slots:
                    if owner_id in item_vars:
                        parent_vars.append(item_vars[owner_id])
                    elif owner_id in effective_item_vars:
                        parent_vars.append(effective_item_vars[owner_id])
                if not parent_vars:
                    model.Add(item_vars[item_id] == 0)
                else:
                    parent_or = model.NewBoolVar(f'parent_or_{item_id}')
                    model.AddMaxEquality(parent_or, parent_vars)
                    model.Add(item_vars[item_id] <= parent_or)

    conflict_pairs_added = set()
    for item_id in available_items:
        if item_id not in item_lookup or item_id not in item_vars: continue
        item_data = item_lookup[item_id]
        conflicting = item_data.get("conflicting_items", [])
        for conflict_id in conflicting:
            if conflict_id in item_vars:
                pair = tuple(sorted([item_id, conflict_id]))
                if pair not in conflict_pairs_added:
                    conflict_pairs_added.add(pair)
                    model.Add(item_vars[item_id] + item_vars[conflict_id] <= 1)

    for slot in weapon["slots"]:
        if slot.get("required", False):
            slot_id = slot["id"]
            items_in_slot = [i for i in slot_items.get(slot_id, []) if i in effective_item_vars]
            if items_in_slot:
                model.Add(sum(effective_item_vars[i] for i in items_in_slot) >= 1)

    for owner_id, slot_ids in compatibility_map["item_to_slots"].items():
        if owner_id not in item_lookup or owner_id not in effective_item_vars: continue
        owner_data = item_lookup[owner_id]
        for slot in owner_data.get("slots", []):
            slot_id = slot["id"]
            if slot.get("required", False):
                items_in_slot = [i for i in slot_items.get(slot_id, []) if i in effective_item_vars]
                if items_in_slot:
                    model.Add(sum(effective_item_vars[i] for i in items_in_slot) >= 1).OnlyEnforceIf(effective_item_vars[owner_id])

    def get_price_terms():
        terms = []
        if fallback_base and fallback_base["type"] == "naked":
            naked_gun_price = 0
        else:
            naked_gun_price = int(weapon["stats"].get("price", 0))
        if "naked" in base_vars:
            terms.append(naked_gun_price * base_vars["naked"])
        for pid in preset_prices_map:
            if pid in base_vars:
                p_price = int(preset_prices_map.get(pid, 0))
                if p_price > 0: terms.append(p_price * base_vars[pid])
        for item_id in available_items:
            if item_id not in buy: continue
            price = int(item_prices[item_id][0])
            if price > 0: terms.append(price * buy[item_id])
        return terms

    if max_price is not None:
        price_terms = get_price_terms()
        if price_terms:
            model.Add(sum(price_terms) <= max_price)

    SCALE = 1000
    weapon_naked_ergo = weapon["stats"].get("naked_ergonomics", 0)
    ERGO_SCALE = 10
    ergo_terms = []
    for item_id in available_items:
        if item_id not in item_vars: continue
        stats = item_lookup[item_id]["stats"]
        ergo = int(stats.get("ergonomics", 0) * ERGO_SCALE)
        ergo_terms.append(ergo * item_vars[item_id])

    total_ergo_scaled_var = model.NewIntVar(-2000, 3000, "total_ergo_scaled")
    model.Add(total_ergo_scaled_var == weapon_naked_ergo * ERGO_SCALE + sum(ergo_terms))
    total_ergo_var = model.NewIntVar(-200, 300, "total_ergo")
    model.AddDivisionEquality(total_ergo_var, total_ergo_scaled_var, ERGO_SCALE)
    ergo_capped_at_100 = model.NewIntVar(-200, 100, "ergo_capped_at_100")
    model.AddMinEquality(ergo_capped_at_100, [total_ergo_var, model.NewConstant(100)])
    capped_ergo_var = model.NewIntVar(0, 100, "capped_ergo")
    model.AddMaxEquality(capped_ergo_var, [ergo_capped_at_100, model.NewConstant(0)])

    recoil_terms = []
    for item_id in available_items:
        if item_id not in item_vars: continue
        stats = item_lookup[item_id]["stats"]
        recoil = int(stats.get("recoil_modifier", 0) * SCALE)
        recoil_terms.append(recoil * item_vars[item_id])
    total_recoil_var = model.NewIntVar(-1000, 500, "total_recoil")
    model.Add(total_recoil_var == sum(recoil_terms))

    if min_ergonomics is not None:
        model.Add(total_ergo_var >= min_ergonomics)

    if max_recoil_v is not None:
        naked_recoil_v = weapon["stats"].get("naked_recoil_v", 100)
        max_recoil_modifier = int(SCALE * (max_recoil_v / naked_recoil_v - 1))
        model.Add(total_recoil_var <= max_recoil_modifier)

    if max_recoil_sum is not None:
        naked_recoil_v = weapon["stats"].get("naked_recoil_v", 0)
        naked_recoil_h = weapon["stats"].get("naked_recoil_h", 0)
        naked_sum = naked_recoil_v + naked_recoil_h
        if naked_sum > 0:
            max_modifier = int(SCALE * (max_recoil_sum / naked_sum - 1))
            model.Add(total_recoil_var <= max_modifier)

    if min_mag_capacity is not None:
        mag_vars_meeting_capacity = []
        for item_id in available_items:
            if item_id not in effective_item_vars: continue
            stats = item_lookup[item_id]["stats"]
            capacity = stats.get("capacity", 0)
            if capacity >= min_mag_capacity:
                mag_vars_meeting_capacity.append(effective_item_vars[item_id])
        if mag_vars_meeting_capacity:
            model.Add(sum(mag_vars_meeting_capacity) >= 1)
        else:
            model.Add(0 >= 1)

    if min_sighting_range is not None:
        base_sighting_range = weapon["stats"].get("sighting_range", 0)
        if base_sighting_range < min_sighting_range:
            sight_vars_meeting_range = []
            for item_id in available_items:
                if item_id not in effective_item_vars: continue
                stats = item_lookup[item_id]["stats"]
                sighting_range = stats.get("sighting_range", 0)
                if sighting_range >= min_sighting_range:
                    sight_vars_meeting_range.append(effective_item_vars[item_id])
            if sight_vars_meeting_range:
                model.Add(sum(sight_vars_meeting_range) >= 1)
            else:
                model.Add(0 >= 1)

    if max_weight is not None:
        WEIGHT_SCALE = 1000
        base_weight_g = int(weapon["stats"].get("weight", 0) * WEIGHT_SCALE)
        max_weight_g = int(max_weight * WEIGHT_SCALE)
        weight_terms = []
        for item_id in available_items:
            if item_id not in item_vars: continue
            stats = item_lookup[item_id]["stats"]
            weight_g = int(stats.get("weight", 0) * WEIGHT_SCALE)
            if weight_g > 0: weight_terms.append(weight_g * item_vars[item_id])
        if weight_terms:
            model.Add(base_weight_g + sum(weight_terms) <= max_weight_g)

    objective_terms = []
    objective_terms.append(int(ergo_weight * SCALE) * capped_ergo_var)
    objective_terms.append(int(-recoil_weight * SCALE) * total_recoil_var)
    if price_weight > 0:
        if fallback_base and fallback_base["type"] == "naked":
            naked_gun_price = 0
        else:
            naked_gun_price = int(weapon["stats"].get("price", 0))
        if "naked" in base_vars:
            objective_terms.append(int(-price_weight * naked_gun_price) * base_vars["naked"])
        for pid in preset_prices_map:
            if pid in base_vars:
                p_price = int(preset_prices_map.get(pid, 0))
                if p_price > 0: objective_terms.append(int(-price_weight * p_price) * base_vars[pid])
        for item_id in available_items:
            if item_id not in buy: continue
            item_price = int(item_prices.get(item_id, (0, None))[0])
            if item_price > 0: objective_terms.append(int(-price_weight * item_price) * buy[item_id])

    model.Maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 120.0
    status = solver.Solve(model)

    if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
        selected_ids = []
        for item_id, var in x.items():
            if solver.Value(var) == 1:
                selected_ids.append(item_id)
        
        # Check which base was selected (naked or preset)
        selected_preset = None
        selected_base = None
        for base_id, var in base_vars.items():
            if solver.Value(var) == 1:
                selected_base = base_id
                if base_id != "naked":
                    # Look up preset details
                    preset_info = next((p for p in presets if p.get("id") == base_id), None)
                    if not preset_info:
                        all_presets = weapon.get("all_presets", [])
                        preset_info = next((p for p in all_presets if p.get("id") == base_id), None)
                    
                    if preset_info:
                        # Get preset image (already processed in extract_all_presets)
                        preset_icon = preset_info.get("image")

                        # Get preset source from offers (already processed) or price_source
                        preset_source = preset_info.get("price_source")
                        if preset_source == "fleaMarket":
                            preset_source = "Flea Market"
                        elif not preset_source or preset_source == "not_available":
                            # Try to get vendor name from offers
                            offers = preset_info.get("offers", [])
                            if offers:
                                preset_source = offers[0].get("vendor_name", "Unknown")

                        selected_preset = {
                            "id": base_id,
                            "name": preset_info.get("name", "Unknown"),
                            "price": int(preset_prices_map.get(base_id, 0)),
                            "items": list(preset_items_map.get(base_id, [])),
                            "icon": preset_icon,
                            "source": preset_source
                        }
                    else:
                        # Should not happen if logic is correct
                        selected_preset = {
                            "id": base_id,
                            "name": "Unknown Preset",
                            "price": 0,
                            "items": [],
                            "icon": None,
                            "source": None
                        }
                break
        
        # Calculate final stats
        weapon_stats = item_lookup[weapon_id]["stats"]
        final_stats = calculate_total_stats(weapon_stats, selected_ids, item_lookup)
        
        # Enrich items with details
        detailed_items = []
        for item_id in selected_ids:
            if item_id in item_lookup:
                item_data = item_lookup[item_id]["data"]
                item_stats = item_lookup[item_id]["stats"]
                
                # Get best image
                icon = (
                    item_data.get("iconLink") or 
                    item_data.get("iconLinkFallback") or 
                    item_data.get("imageLink") or 
                    item_data.get("image512pxLink")
                )
                
                detailed_items.append({
                    "id": item_id,
                    "name": item_data.get("name", "Unknown"),
                    "price": item_stats.get("price", 0),
                    "icon": icon,
                    "source": item_stats.get("price_source", "Unknown"),
                    "ergonomics": item_stats.get("ergonomics", 0),
                    "recoil_modifier": item_stats.get("recoil_modifier", 0)
                })
            else:
                detailed_items.append({
                    "id": item_id,
                    "name": "Unknown Item",
                    "price": 0,
                    "icon": None,
                    "source": "Unknown",
                    "ergonomics": 0,
                    "recoil_modifier": 0
                })
        
        # Add base weapon cost to total cost if applicable
        base_price = 0
        if selected_preset:
            # If using a preset, use its price
            base_price = selected_preset["price"]
        elif not fallback_base or fallback_base["type"] != "naked":
             # Naked gun price (if not fallback naked with 0 price)
             base_price = int(weapon_stats.get("price", 0))
             
        final_stats["total_price"] += base_price

        status_str = "optimal" if status == cp_model.OPTIMAL else "feasible"
        return {
            "status": status_str,
            "selected_items": detailed_items,
            "selected_preset": selected_preset,
            "fallback_base": fallback_base,
            "objective_value": solver.ObjectiveValue(),
            "final_stats": final_stats
        }
    else:
        reason = "No valid configuration found"
        return {
            "status": "infeasible",
            "reason": reason,
            "selected_items": [],
            "selected_preset": None,
            "objective_value": 0,
        }

def explore_pareto(
    weapon_id, item_lookup, compatibility_map,
    ignore="price",
    max_price=None,
    min_ergonomics=None,
    max_recoil_v=None,
    max_recoil_sum=None,
    min_mag_capacity=None,
    min_sighting_range=None,
    max_weight=None,
    include_items=None,
    exclude_items=None,
    include_categories=None,
    exclude_categories=None,
    steps=10,
    trader_levels=None,
    flea_available=True,
    player_level=None
):
    weapon_stats = item_lookup[weapon_id]["stats"]
    naked_recoil_v = weapon_stats.get("naked_recoil_v", 100)
    frontier = []
    
    constraint_kwargs = {
        "trader_levels": trader_levels,
        "flea_available": flea_available,
        "player_level": player_level,
        "min_mag_capacity": min_mag_capacity,
        "min_sighting_range": min_sighting_range,
        "max_recoil_sum": max_recoil_sum,
        "max_weight": max_weight,
        "include_items": include_items,
        "exclude_items": exclude_items,
        "include_categories": include_categories,
        "exclude_categories": exclude_categories,
    }

    RECOIL_WEIGHTS = {"ergo_weight": 0, "recoil_weight": 1, "price_weight": 0}
    ERGO_WEIGHTS = {"ergo_weight": 1, "recoil_weight": 0, "price_weight": 0}
    PRICE_WEIGHTS = {"ergo_weight": 0, "recoil_weight": 0, "price_weight": 1}

    def _get_result(weights, **kwargs):
        # Helper to merge kwargs and run optimize
        run_kwargs = constraint_kwargs.copy()
        run_kwargs.update(kwargs)
        return optimize_weapon(weapon_id, item_lookup, compatibility_map, **weights, **run_kwargs)

    # Simplified logic: determine X and Y axis ranges and sample
    # Note: Full explore_pareto logic from original file is preserved conceptually but abridged for brevity here
    # If explicit step-by-step logic is needed, it can be pasted from the original file.
    # For now, I will assume the original implementation's logic is desired.
    
    # ... [Insert full explore_pareto logic from original file if strict parity is needed] ...
    # Since I'm refactoring, I'll paste the logic back in fully to ensure it works.
    
    if ignore == "price":
        result_low = _get_result(RECOIL_WEIGHTS, max_price=max_price, max_recoil_v=max_recoil_v)
        result_high = _get_result(ERGO_WEIGHTS, max_price=max_price, max_recoil_v=max_recoil_v)

        if result_low["status"] == "infeasible": return []
        stats_low = result_low["final_stats"]
        range_min = int(stats_low["ergonomics"])

        if result_high["status"] != "infeasible":
            stats_high = result_high["final_stats"]
            range_max = int(stats_high["ergonomics"])
        else:
            range_max = 100

        if min_ergonomics is not None: range_min = max(range_min, min_ergonomics)
        range_min = max(0, range_min)
        range_max = min(100, range_max)
        if range_max <= range_min: range_max = range_min + 1
        step_size = (range_max - range_min) / (steps - 1) if steps > 1 else 0

        for i in range(steps):
            target = int(range_min + i * step_size)
            result = _get_result(RECOIL_WEIGHTS, max_price=max_price, min_ergonomics=target, max_recoil_v=max_recoil_v)
            if result["status"] != "infeasible":
                stats = result["final_stats"]
                frontier.append(_build_frontier_point(stats, result))

    elif ignore == "recoil":
        result_low = _get_result(PRICE_WEIGHTS, max_price=max_price, max_recoil_v=max_recoil_v)
        result_high = _get_result(ERGO_WEIGHTS, max_price=max_price, max_recoil_v=max_recoil_v)

        if result_low["status"] == "infeasible": return []
        stats_low = result_low["final_stats"]
        range_min = int(stats_low["ergonomics"])

        if result_high["status"] != "infeasible":
            stats_high = result_high["final_stats"]
            range_max = int(stats_high["ergonomics"])
        else:
            range_max = 100
            
        if min_ergonomics is not None: range_min = max(range_min, min_ergonomics)
        range_min = max(0, range_min)
        range_max = min(100, range_max)
        if range_max <= range_min: range_max = range_min + 1
        step_size = (range_max - range_min) / (steps - 1) if steps > 1 else 0

        for i in range(steps):
            target = int(range_min + i * step_size)
            result = _get_result(PRICE_WEIGHTS, max_price=max_price, min_ergonomics=target, max_recoil_v=max_recoil_v)
            if result["status"] != "infeasible":
                stats = result["final_stats"]
                frontier.append(_build_frontier_point(stats, result))

    elif ignore == "ergo":
        result_low = _get_result(RECOIL_WEIGHTS, max_price=max_price, min_ergonomics=min_ergonomics)
        result_high = _get_result(PRICE_WEIGHTS, max_price=max_price, min_ergonomics=min_ergonomics)

        if result_low["status"] == "infeasible": return []
        stats_low = result_low["final_stats"]
        range_min = stats_low["recoil_vertical"]

        if result_high["status"] != "infeasible":
            stats_high = result_high["final_stats"]
            range_max = stats_high["recoil_vertical"]
        else:
            range_max = naked_recoil_v

        if max_recoil_v is not None: range_max = min(range_max, max_recoil_v)
        if range_max <= range_min: range_max = range_min + 1
        step_size = (range_max - range_min) / (steps - 1) if steps > 1 else 0

        for i in range(steps):
            target = range_min + i * step_size
            result = _get_result(PRICE_WEIGHTS, max_price=max_price, min_ergonomics=min_ergonomics, max_recoil_v=target)
            if result["status"] != "infeasible":
                stats = result["final_stats"]
                frontier.append(_build_frontier_point(stats, result))

    seen = set()
    unique_frontier = []
    for point in frontier:
        key = (point["ergo"], point["recoil_v"], point["price"])
        if key not in seen:
            seen.add(key)
            unique_frontier.append(point)
    return unique_frontier

def _build_frontier_point(stats, result):
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
