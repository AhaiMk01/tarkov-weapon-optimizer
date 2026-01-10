"""
Tarkov Weapon Mod Optimizer
Uses BFS to build a compatibility map and CP-SAT solver for optimization.

The optimizer uses weapon defaultPreset as the baseline:
- Base stats (ergonomics, recoil) come from defaultErgonomics/defaultRecoilVertical
- These represent the weapon WITH its default preset configuration
- The optimizer finds the best mod configuration from this baseline
- UI displays the defaultPreset image and included items
"""

import hashlib
import json
import os
import sys
import time

import requests
from collections import deque
from loguru import logger
from ortools.sat.python import cp_model

from queries import GUNS_QUERY, MODS_QUERY

# Configure loguru
# Remove default handler and add custom one
logger.remove()
_console_handler_id = None

# Check if running in PyInstaller frozen environment
# sys.stderr may be None or an unsupported type in frozen apps
if not getattr(sys, 'frozen', False) and sys.stderr is not None:
    try:
        _console_handler_id = logger.add(
            sys.stderr,
            format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
            level="INFO",
        )
    except TypeError:
        # Fallback if stderr is not a valid sink
        pass

# Also log to file with rotation (if possible)
_log_dir = os.path.join(os.path.dirname(__file__), "logs")
try:
    os.makedirs(_log_dir, exist_ok=True)
    logger.add(
        os.path.join(_log_dir, "tarkov_optimizer_{time}.log"),
        rotation="10 MB",
        retention="7 days",
        level="DEBUG",
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
    )
except (OSError, PermissionError):
    # File logging not available, continue with console only
    pass


def set_log_level(level: str):
    """Set the console logging level.

    Args:
        level: Log level string (DEBUG, INFO, WARNING, ERROR, CRITICAL)
    """
    global _console_handler_id
    logger.remove(_console_handler_id)
    _console_handler_id = logger.add(
        sys.stderr,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        level=level.upper(),
    )
    logger.info(f"Log level set to {level.upper()}")

API_URL = "https://api.tarkov.dev/graphql"
CACHE_DIR = os.path.join(os.path.dirname(__file__), ".cache")
CACHE_TTL = 3600  # 1 hour in seconds
CACHE_VERSION = 7  # Increment when data format changes


def _get_cache_path(query, variables):
    """Generate a cache file path based on query hash."""
    key = hashlib.md5((query + json.dumps(variables or {}, sort_keys=True)).encode()).hexdigest()
    return os.path.join(CACHE_DIR, f"{key}.json")


def _load_cache(cache_path):
    """Load cached data if it exists, is not expired, and matches current version."""
    if not os.path.exists(cache_path):
        logger.debug(f"Cache miss: file does not exist at {cache_path}")
        return None
    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            cached = json.load(f)
        # Check version and TTL
        if cached.get("version") != CACHE_VERSION:
            logger.debug(f"Cache invalidated: version mismatch (cached={cached.get('version')}, current={CACHE_VERSION})")
            return None  # Version mismatch, invalidate cache
        age = time.time() - cached.get("timestamp", 0)
        if age < CACHE_TTL:
            logger.debug(f"Cache hit: loaded data from {cache_path} (age={age:.0f}s)")
            return cached.get("data")
        logger.debug(f"Cache expired: age={age:.0f}s > TTL={CACHE_TTL}s")
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"Cache load error: {e}")
    return None


def _save_cache(cache_path, data):
    """Save data to cache with timestamp and version."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump({"timestamp": time.time(), "version": CACHE_VERSION, "data": data}, f)
    logger.debug(f"Cache saved to {cache_path}")


def run_query(query, variables=None, max_retries=3):
    """Execute a GraphQL query against the Tarkov API with 1-hour cache and retry logic."""
    cache_path = _get_cache_path(query, variables)

    # Try to load from cache
    cached_data = _load_cache(cache_path)
    if cached_data is not None:
        return cached_data

    # Fetch from API with retry logic
    logger.info("Fetching data from Tarkov.dev API...")
    last_error = None

    for attempt in range(1, max_retries + 1):
        start_time = time.time()
        try:
            resp = requests.post(
                API_URL,
                json={"query": query, "variables": variables or {}},
                timeout=90,
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
            elapsed = time.time() - start_time
            logger.debug(f"API request completed in {elapsed:.2f}s (status={resp.status_code})")

            data = resp.json()
            if "errors" in data:
                logger.error(f"GraphQL errors: {data['errors']}")
                raise RuntimeError(data["errors"])

            result = data["data"]
            _save_cache(cache_path, result)
            return result

        except requests.exceptions.ChunkedEncodingError as e:
            last_error = e
            logger.warning(f"API request failed (attempt {attempt}/{max_retries}): Response ended prematurely")
        except requests.exceptions.Timeout as e:
            last_error = e
            logger.warning(f"API request timed out (attempt {attempt}/{max_retries})")
        except requests.exceptions.ConnectionError as e:
            last_error = e
            logger.warning(f"API connection error (attempt {attempt}/{max_retries}): {e}")
        except requests.RequestException as e:
            last_error = e
            logger.warning(f"API request failed (attempt {attempt}/{max_retries}): {e}")

        if attempt < max_retries:
            wait_time = 2 ** attempt  # Exponential backoff: 2, 4, 8 seconds
            logger.info(f"Retrying in {wait_time}s...")
            time.sleep(wait_time)

    logger.error(f"API request failed after {max_retries} attempts: {last_error}")
    raise RuntimeError(f"Failed to fetch data from API after {max_retries} attempts: {last_error}")


def fetch_all_data():
    """Fetch all guns and mods from the API (cached for 1 hour)."""
    logger.info("Fetching guns...")
    guns_data = run_query(GUNS_QUERY)
    logger.info(f"Found {len(guns_data['itemsByType'])} guns")

    logger.info("Fetching mods...")
    mods_data = run_query(MODS_QUERY)
    logger.info(f"Found {len(mods_data['itemsByType'])} mods")

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
    logger.info("Building item lookup table...")
    lookup = {}
    skipped_mods = 0

    # Add guns
    for gun in guns:
        lookup[gun["id"]] = {
            "type": "gun",
            "data": gun,
            "slots": extract_slots(gun),
            "stats": extract_gun_stats(gun),
            "presets": extract_all_presets(gun),  # List of purchasable presets
            "all_presets": extract_all_presets(gun, include_unpurchasable=True),  # All presets for fallback
        }

    # Add mods (only those with valid prices)
    for mod in mods:
        if not has_valid_price(mod):
            skipped_mods += 1
            continue  # Skip mods without valid market price
        lookup[mod["id"]] = {
            "type": "mod",
            "data": mod,
            "slots": extract_slots_from_mod(mod),
            "stats": extract_mod_stats(mod),
            "conflicting_items": extract_conflicting_items(mod),
            "conflicting_slot_ids": mod.get("conflictingSlotIds", []) or [],
        }

    logger.info(f"Item lookup built: {len(guns)} guns, {len(mods) - skipped_mods} mods (skipped {skipped_mods} mods without valid prices)")
    logger.debug(f"Total items indexed: {len(lookup)}")
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


def extract_all_presets(gun, include_unpurchasable=False):
    """Extract all preset information from a gun.

    Returns a list of presets, each containing:
    - id: preset identifier
    - name: preset display name
    - items: list of item IDs in this preset
    - image: preset image URL
    - price: lowest price (0 if not purchasable)
    - price_source: lowest price source
    - offers: list of all offers with trader level info
    - purchasable: whether this preset can be bought (price > 0)

    Args:
        gun: Gun data from API
        include_unpurchasable: If True, include presets with no purchase offers
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
            or preset.get("imageLink")
            or preset.get("image8xLink")
            or preset.get("gridImageLink")
            or preset.get("baseImageLink")
        )

        # Extract all buyFor offers
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

        # Include preset if purchasable OR if we want all presets
        if purchasable or include_unpurchasable:
            presets.append(
                {
                    "id": preset.get("id", ""),
                    "name": preset.get("name", "") or preset.get("shortName", "Unknown"),
                    "items": preset_items,
                    "image": preset_image,
                    "price": lowest_price,
                    "price_source": price_source,
                    "offers": offers,
                    "purchasable": purchasable,
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
            # No presets and no trader offers - gun is not purchasable
            # Note: We intentionally do NOT fall back to basePrice - only real market prices
            lowest_price = 999999999  # Prohibitively expensive
            price_source = "not_available"

    # Get defaultPreset image
    default_preset = props.get("defaultPreset", {}) or {}
    default_preset_image = (
        default_preset.get("image512pxLink")
        or default_preset.get("imageLink")
        or default_preset.get("image8xLink")
        or default_preset.get("gridImageLink")
        or default_preset.get("gridImageLinkFallback")
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
        "fire_modes": props.get("fireModes", []) or [],
        "caliber": props.get("caliber", ""),
        "weight": gun.get("weight", 0) or 0,
        "width": gun.get("width", 0) or 0,
        "height": gun.get("height", 0) or 0,
        "sighting_range": props.get("sightingRange") or 0,
        # Category
        "category": gun.get("bsgCategory", {}).get("name", "") if gun.get("bsgCategory") else "",
        "category_id": gun.get("bsgCategory", {}).get("id", "") if gun.get("bsgCategory") else "",
        # Weapon handling properties
        "camera_snap": props.get("cameraSnap", 0) or 0,
        "center_of_impact": props.get("centerOfImpact", 0) or 0,
        "deviation_max": props.get("deviationMax", 0) or 0,
        "deviation_curve": props.get("deviationCurve", 0) or 0,
        "recoil_angle": props.get("recoilAngle", 0) or 0,
        "recoil_dispersion": props.get("recoilDispersion", 0) or 0,
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

    # Extract all buyFor offers with trader level info
    buy_for = mod.get("buyFor", []) or []
    offers = []
    lowest_price = 0
    price_source = "market"

    for offer in buy_for:
        if not isinstance(offer, dict):
            continue
        price = offer.get("priceRUB") or 0
        if price <= 0:
            continue

        source = offer.get("source", "")
        vendor = offer.get("vendor", {}) or {}

        # Extract trader level (1-4) or None for flea
        trader_level = None
        if source == "fleaMarket":
            trader_level = None  # Flea market has no level requirement
        else:
            trader_level = vendor.get("minTraderLevel") or 1

        offers.append({
            "price": price,
            "source": source,
            "vendor_name": vendor.get("name", ""),
            "vendor_normalized": vendor.get("normalizedName", ""),
            "trader_level": trader_level,
        })

    # Sort offers by price for easy lookup
    offers.sort(key=lambda x: x["price"])

    if offers:
        lowest_price = offers[0]["price"]
        price_source = offers[0]["source"]

    return {
        # Flat ergonomics bonus/penalty
        "ergonomics": ergo,
        # Percentage recoil modifier as decimal (e.g., -0.05 for -5%)
        "recoil_modifier": recoil_mod,
        # Accuracy modifier
        "accuracy_modifier": mod.get("accuracyModifier", 0) or 0,
        # All available offers (sorted by price)
        "offers": offers,
        # Default price (lowest available)
        "price": lowest_price,
        # Price source (trader name or "market")
        "price_source": price_source,
        # Weight
        "weight": mod.get("weight", 0) or 0,
        # Grid size
        "width": mod.get("width", 0) or 0,
        "height": mod.get("height", 0) or 0,
        # Minimum player level required to buy from flea market
        "min_level_flea": mod.get("minLevelForFlea") or 0,
        # Magazine capacity (only for magazines)
        "capacity": props.get("capacity") or 0,
        # Sighting range in meters (only for scopes/sights)
        "sighting_range": props.get("sightingRange") or 0,
        # BSG Category name (e.g. "Silencer", "Scope")
        "category": mod.get("bsgCategory", {}).get("name"),
    }


# Default trader levels (all maxed) - only traders who sell weapon mods
DEFAULT_TRADER_LEVELS = {
    "prapor": 4,
    "skier": 4,
    "peacekeeper": 4,
    "mechanic": 4,
    "jaeger": 4,
}


def get_available_price(stats, trader_levels=None, flea_available=True, player_level=None):
    """Get the best available price for an item given trader levels and flea access.

    Args:
        stats: Item stats dict containing 'offers' list
        trader_levels: Dict mapping trader name (normalized) to level (1-4).
                       If None, defaults to all traders at level 4.
        flea_available: Whether flea market is accessible
        player_level: Player's PMC level. Used to check minLevelForFlea requirement.
                      If None, no player level restriction is applied.

    Returns:
        Tuple of (price, source, is_available)
        - price: Best available price (0 if unavailable)
        - source: Where to buy from
        - is_available: Whether the item can be purchased at all
    """
    if trader_levels is None:
        trader_levels = DEFAULT_TRADER_LEVELS

    # Get the minimum level required to buy this item from flea
    min_level_flea = stats.get("min_level_flea", 0)

    offers = stats.get("offers")
    if not offers:
        # Fallback for items without offers data (legacy cache or no traders sell it)
        # Check if there's a default price available
        default_price = stats.get("price", 0)
        if default_price > 0 and flea_available:
            # Check player level requirement for flea
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

        # Check if this offer is accessible
        if source == "fleaMarket":
            if not flea_available:
                continue
            # Check player level requirement for this item on flea
            if player_level is not None and min_level_flea > player_level:
                continue
        else:
            # Trader offer - check level requirement for this specific trader
            trader_level = trader_levels.get(vendor, 4)  # Default to 4 if unknown trader
            if required_level is not None and required_level > trader_level:
                continue

        # This offer is accessible
        if best_price is None or price < best_price:
            best_price = price
            best_source = source

    if best_price is not None:
        return (best_price, best_source, True)
    return (0, None, False)


def build_compatibility_map(weapon_id, item_lookup):
    """
    Perform BFS from the weapon to find all reachable mods.
    Returns a dict of reachable items with their slot context.

    Key fix: Each slot has a unique ID per parent item, so we track slot ownership
    to properly handle dependency constraints.
    """
    logger.debug(f"Building compatibility map for weapon {weapon_id}")
    reachable = {}  # item_id -> {"item": item_data}
    slot_items = {}  # slot_id -> list of item_ids that can go in that slot
    item_to_slots = {}  # item_id -> list of slot_ids it owns
    slot_owner = {}  # slot_id -> item_id that owns this slot (or weapon_id)

    if weapon_id not in item_lookup:
        logger.error(f"Weapon {weapon_id} not found in item lookup")
        raise ValueError(f"Weapon {weapon_id} not found in item lookup")

    weapon = item_lookup[weapon_id]
    queue = deque()

    # Start BFS from weapon's slots
    for slot in weapon["slots"]:
        slot_id = slot["id"]
        slot_items[slot_id] = []
        slot_owner[slot_id] = weapon_id  # Weapon owns this slot

        for allowed_id in slot["allowedItems"]:
            # Skip the weapon itself - it can't be a mod of itself
            if allowed_id == weapon_id:
                continue
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
                if allowed_id in item_lookup:
                    slot_items[slot_id].append(allowed_id)
                    if allowed_id not in visited:
                        queue.append((allowed_id, slot_id))

    logger.debug(f"Compatibility map built: {len(reachable)} reachable mods, {len(slot_items)} slots")
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
        min_mag_capacity: Optional minimum magazine capacity (always respected if set)
        min_sighting_range: Optional minimum sighting range (always respected if set)
        max_weight: Optional maximum total weight (always respected if set)
        include_items: Set of item IDs to require
        exclude_items: Set of item IDs to ban
        include_categories: Set of category names to require
        exclude_categories: Set of category names to ban
        steps: Number of points to sample along the frontier
        trader_levels: Dict mapping trader name to level (1-4). If None, all at LL4.
        flea_available: Whether flea market is accessible
        player_level: Player's PMC level. Used to filter items by minLevelForFlea.

    Returns:
        List of dicts with keys: ergo, recoil_pct, recoil_v, recoil_h, price, ...
    """
    weapon_stats = item_lookup[weapon_id]["stats"]
    naked_recoil_v = weapon_stats.get("naked_recoil_v", 100)

    logger.info(f"Exploring Pareto frontier (ignore={ignore}, steps={steps})")
    frontier = []

    # Common kwargs for all constraints
    constraint_kwargs = {
        "trader_levels": trader_levels,
        "flea_available": flea_available,
        "player_level": player_level,
        "min_mag_capacity": min_mag_capacity,
        "min_sighting_range": min_sighting_range,
        "max_weight": max_weight,
        "include_items": include_items,
        "exclude_items": exclude_items,
        "include_categories": include_categories,
        "exclude_categories": exclude_categories,
    }

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
            **RECOIL_WEIGHTS, **constraint_kwargs
        )
        result_high = optimize_weapon(
            weapon_id, item_lookup, compatibility_map,
            max_price=max_price, max_recoil_v=max_recoil_v,
            **ERGO_WEIGHTS, **constraint_kwargs
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
                **RECOIL_WEIGHTS, **constraint_kwargs
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
            **PRICE_WEIGHTS, **constraint_kwargs
        )
        result_high = optimize_weapon(
            weapon_id, item_lookup, compatibility_map,
            max_price=max_price, max_recoil_v=max_recoil_v,
            **ERGO_WEIGHTS, **constraint_kwargs
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
                **PRICE_WEIGHTS, **constraint_kwargs
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
            **RECOIL_WEIGHTS, **constraint_kwargs
        )
        result_high = optimize_weapon(
            weapon_id, item_lookup, compatibility_map,
            max_price=max_price, min_ergonomics=min_ergonomics,
            **PRICE_WEIGHTS, **constraint_kwargs
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
                **PRICE_WEIGHTS, **constraint_kwargs
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

    logger.info(f"Pareto frontier exploration complete: {len(unique_frontier)} unique points")
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


def _check_constraints_feasibility(
    weapon, item_lookup, compatibility_map,
    max_price=None, min_ergonomics=None, max_recoil_v=None, max_recoil_sum=None,
    min_mag_capacity=None, min_sighting_range=None, max_weight=None,
    include_items=None, exclude_items=None,
    include_categories=None, exclude_categories=None,
    trader_levels=None, flea_available=True
):
    """
    Check if constraints are feasible and return reasons if not.
    Returns None if feasible, or a list of reason strings if infeasible.
    """
    reasons = []

    available_items = compatibility_map["reachable_items"]
    item_vars = {item_id: i for i, item_id in enumerate(available_items)}

    # Check include_items
    if include_items:
        for req_id in include_items:
            if req_id not in available_items:
                name = item_lookup.get(req_id, {}).get("data", {}).get("name", req_id)
                reasons.append(f"Required item '{name}' is not compatible with this weapon")

    # Check include_categories
    if include_categories:
        for i, group in enumerate(include_categories):
            group_names = [cat for cat in group if isinstance(cat, str)]
            if not group_names:
                continue
            found = False
            for item_id in available_items:
                cat = item_lookup[item_id]["stats"].get("category", "")
                if cat in group_names:
                    found = True
                    break
            if not found:
                reasons.append(f"No items found for required category group: {group_names}")

    # Check min_mag_capacity
    if min_mag_capacity:
        has_adequate_mag = False
        for item_id in available_items:
            stats = item_lookup[item_id]["stats"]
            if stats.get("capacity", 0) >= min_mag_capacity:
                has_adequate_mag = True
                break
        if not has_adequate_mag:
            reasons.append(f"No magazine with capacity >= {min_mag_capacity} rounds available")

    # Check min_sighting_range
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

    # Check max_weight
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
    """
    Use CP-SAT solver to find optimal mod configuration.

    Args:
        max_price: Optional budget constraint (total build cost)
        min_ergonomics: Optional minimum final ergonomics (e.g., 50 means final ergo >= 50)
        max_recoil_v: Optional maximum final vertical recoil (e.g., 70 means final recoil <= 70)
        min_mag_capacity: Optional minimum magazine capacity (e.g., 30 means mag >= 30 rounds)
        min_sighting_range: Optional minimum sighting range in meters (e.g., 100 means sight >= 100m)
        max_weight: Optional maximum total weight in kg (e.g., 5.0 means total <= 5kg)
        include_items: Set of item IDs to require
        exclude_items: Set of item IDs to ban
        include_categories: Set of category names to require
        exclude_categories: Set of category names to ban
        ergo_weight: Weight for ergonomics in objective (higher = prioritize ergo)
        recoil_weight: Weight for recoil reduction in objective (higher = prioritize low recoil)
        price_weight: Weight for price in objective (higher = prioritize low cost)
        trader_levels: Dict mapping trader name to level (1-4). If None, all traders at LL4.
                       Example: {"prapor": 3, "mechanic": 4, "skier": 2, ...}
        flea_available: Whether flea market is accessible (requires player level 15)
        player_level: Player's PMC level. Used to filter items by minLevelForFlea.
                      If None, no player level restriction is applied.

    Constraints:
    - Mutex: At most one item per slot
    - Dependency: Child item requires parent item
    - Conflicts: Items with conflictingItems can't both be selected
    - Required: API-marked required slots must have exactly one item
    - Availability: Items must be purchasable at given trader levels or from flea
    - Player Level: Items with minLevelForFlea > player_level are excluded from flea
    - Magazine Capacity: At least one selected magazine must meet min_mag_capacity
    - Sighting Range: At least one selected sight/scope must meet min_sighting_range
    - Max Weight: Total weight of selected mods must not exceed max_weight
    - Included/Excluded Items/Categories: Respect user preferences
    """
    if trader_levels is None:
        trader_levels = DEFAULT_TRADER_LEVELS

    weapon = item_lookup[weapon_id]
    weapon_name = weapon["data"].get("name", weapon_id)
    logger.info(f"Starting optimization for {weapon_name}")
    logger.debug(f"Weights: ergo={ergo_weight}, recoil={recoil_weight}, price={price_weight}")
    if max_price:
        logger.debug(f"Budget constraint: max_price={max_price}")
    if min_ergonomics:
        logger.debug(f"Ergo constraint: min_ergonomics={min_ergonomics}")
    if max_recoil_v:
        logger.debug(f"Recoil constraint: max_recoil_v={max_recoil_v}")

    # Check constraints feasibility before running solver
    feasibility_reasons = _check_constraints_feasibility(
        weapon, item_lookup, compatibility_map,
        max_price, min_ergonomics, max_recoil_v, max_recoil_sum,
        min_mag_capacity, min_sighting_range, max_weight,
        include_items, exclude_items, include_categories, exclude_categories,
        trader_levels, flea_available
    )
    if feasibility_reasons is not None:
        logger.warning(f"Optimization infeasible: {'; '.join(feasibility_reasons)}")
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

    # Build preset maps early to support "unavailable but in preset" logic
    presets = weapon.get("presets", [])
    preset_items_map = {}  # preset_id -> set of item_ids
    item_to_presets = {}   # item_id -> list of preset_ids
    preset_prices_map = {} # preset_id -> effective price
    
    for i, preset in enumerate(presets):
        # Calculate available price for this preset using trader levels
        p_price, p_source, p_avail = get_available_price(
            {"offers": preset.get("offers", []), "price": preset.get("price", 0)},
            trader_levels, flea_available, player_level
        )
        
        if not p_avail:
            continue

        preset_id = preset.get("id", f"preset_{i}")
        preset_prices_map[preset_id] = p_price
        
        items_in_preset = set(preset.get("items", []))
        preset_items_map[preset_id] = items_in_preset
        for item_id in items_in_preset:
            if item_id not in item_to_presets:
                item_to_presets[item_id] = []
            item_to_presets[item_id].append(preset_id)

    # Filter reachable items by availability at given trader levels and player level
    # Key Logic: Item is available if (Available from Trader/Flea) OR (Included in a Preset)
    available_items = {}
    item_prices = {}  # item_id -> (price, source, is_available)

    exclude_items_set = set(exclude_items) if exclude_items else set()
    exclude_categories_set = set(exclude_categories) if exclude_categories else set()

    for item_id in reachable:
        if item_id not in item_lookup:
            continue

        # Explicit exclusion
        if item_id in exclude_items_set:
            continue

        stats = item_lookup[item_id]["stats"]

        # Category exclusion
        category = stats.get("category")
        if category and category in exclude_categories_set:
            continue

        price, source, is_available = get_available_price(
            stats, trader_levels, flea_available, player_level
        )

        # If not available individually, check if it's in any preset
        in_preset = item_id in item_to_presets

        # For guns with extremely high price (>100M), they are NOT available individually
        # even if in a preset - they can ONLY be obtained via presets
        default_price = stats.get("price", 0)
        if default_price > 100_000_000:
            # Only available if in a preset and we're NOT selecting it individually
            # We mark it as unavailable for individual selection
            if not in_preset:
                continue
            # Mark as unavailable for individual selection (price=0 for individual)
            price = 0
            is_available = False

        if not is_available and not in_preset:
            continue

        available_items[item_id] = reachable[item_id]
        item_prices[item_id] = (price, source, is_available)

    model = cp_model.CpModel()

    # ============================================================
    # CLEANER MODEL: Separate "in build" (x) from "pay for" (buy)
    # ============================================================
    # x[i] = 1 if item i is in the final build
    # p[j] = 1 if base j is selected (naked gun or a preset)
    # buy[i] = 1 if we pay for item i individually
    #
    # Key insight: An item is "in the build" if selected, regardless of
    # whether it came from a preset or was bought individually.
    # Cost is tracked separately via buy[i].
    # ============================================================

    # Create base selection variables (naked gun OR one preset)
    base_vars = {}
    naked_gun_price_raw = weapon["stats"].get("price", 0)
    naked_gun_purchasable = naked_gun_price_raw < 100_000_000
    fallback_base = None  # Track if we're using a fallback base with price=0

    if naked_gun_purchasable:
        base_vars["naked"] = model.NewBoolVar("base_naked")

    for preset_id in preset_items_map:
        base_vars[preset_id] = model.NewBoolVar(f"base_{preset_id}")

    # Constraint: Exactly one base must be selected
    if base_vars:
        model.Add(sum(base_vars.values()) == 1)
    else:
        # No purchasable base - use fallback with price=0
        # Priority: default preset (first in all_presets) > naked gun
        logger.warning("No purchasable base (naked gun or preset) available, using fallback with price=0")

        all_presets = weapon.get("all_presets", [])
        if all_presets:
            # Use the first preset (typically the default) as fallback with price=0
            fallback_preset = all_presets[0]
            fallback_preset_id = fallback_preset.get("id", "fallback_preset_0")
            logger.info(f"Using fallback preset: {fallback_preset.get('name', 'Unknown')} with price=0")

            base_vars[fallback_preset_id] = model.NewBoolVar(f"base_{fallback_preset_id}")
            model.Add(base_vars[fallback_preset_id] == 1)  # Force selection

            # Add fallback preset items to preset_items_map and item_to_presets
            fallback_items = set(fallback_preset.get("items", []))
            preset_items_map[fallback_preset_id] = fallback_items
            preset_prices_map[fallback_preset_id] = 0  # Price is 0 for fallback
            for item_id in fallback_items:
                if item_id not in item_to_presets:
                    item_to_presets[item_id] = []
                item_to_presets[item_id].append(fallback_preset_id)
                # Also ensure these items are in available_items
                if item_id in reachable and item_id not in available_items:
                    available_items[item_id] = reachable[item_id]
                    item_prices[item_id] = (0, "fallback_preset", False)

            fallback_base = {
                "type": "preset",
                "id": fallback_preset_id,
                "name": fallback_preset.get("name", "Unknown"),
                "price": 0,
            }
        else:
            # No presets at all - use naked gun as fallback with price=0
            logger.info("No presets available, using naked gun with price=0")
            base_vars["naked"] = model.NewBoolVar("base_naked")
            model.Add(base_vars["naked"] == 1)  # Force selection
            fallback_base = {
                "type": "naked",
                "price": 0,
            }

    # Create x[i] = "item i is in the build" variables
    x = {}  # item_id -> BoolVar
    for item_id in available_items:
        x[item_id] = model.NewBoolVar(f"x_{item_id}")

    # Track item availability info
    item_only_in_preset = {}  # item_id -> True if only available via preset
    for item_id in available_items:
        containing_presets = item_to_presets.get(item_id, [])
        is_individually_available = item_prices[item_id][2]
        item_only_in_preset[item_id] = not is_individually_available and bool(containing_presets)

    # Constraint: Item availability
    # x[i] can only be 1 if: (available individually) OR (in a selected preset)
    for item_id in available_items:
        is_individually_available = item_prices[item_id][2]
        containing_presets = [base_vars[pid] for pid in item_to_presets.get(item_id, [])
                             if pid in base_vars]

        if not is_individually_available:
            if containing_presets:
                # Only available via preset - x[i] <= sum of containing preset vars
                model.Add(x[item_id] <= sum(containing_presets))
            else:
                # Not available at all (shouldn't happen due to earlier filtering)
                model.Add(x[item_id] == 0)

    # Create buy[i] = "we pay for item i individually" variables
    buy = {}  # item_id -> BoolVar
    for item_id in available_items:
        buy[item_id] = model.NewBoolVar(f"buy_{item_id}")

        containing_presets = [base_vars[pid] for pid in item_to_presets.get(item_id, [])
                             if pid in base_vars]

        if containing_presets:
            # buy[i] = x[i] AND NOT any_preset_containing_i
            # Linearized: buy >= x - sum(presets), buy <= x, buy <= 1 - each preset
            any_preset_with_item = model.NewBoolVar(f"preset_has_{item_id}")
            model.AddMaxEquality(any_preset_with_item, containing_presets)

            # buy = x AND NOT any_preset_with_item
            model.Add(buy[item_id] <= x[item_id])
            model.Add(buy[item_id] <= 1 - any_preset_with_item)
            model.Add(buy[item_id] >= x[item_id] - any_preset_with_item)
        else:
            # Not in any preset - must pay if selected
            model.Add(buy[item_id] == x[item_id])

    # For backward compatibility, create aliases
    item_vars = x  # x[i] is what we use for constraints
    effective_item_vars = x  # x[i] already represents "in build"
    preset_vars = {k: v for k, v in base_vars.items() if k != "naked"}  # Exclude naked

    # Constraint: Included items
    if include_items:
        for req_id in include_items:
            if req_id in item_vars:
                model.Add(item_vars[req_id] == 1)
            else:
                # Required item is not available -> infeasible
                model.Add(0 == 1)

    # Constraint: Included categories (List of Groups, where each Group is OR)
    if include_categories:
        for group in include_categories:
            group_vars = []
            for req_cat in group:
                for item_id, var in item_vars.items():
                    if item_lookup[item_id]["stats"].get("category") == req_cat:
                        group_vars.append(var)
            if group_vars:
                model.Add(sum(group_vars) >= 1)
            else:
                # No available items for required category group -> infeasible
                model.Add(0 == 1)

    # Constraint: Availability (Item <= Presets if not individually available)
    for item_id, var in item_vars.items():
        is_avail = item_prices[item_id][2]
        if not is_avail:
            containing = [preset_vars[pid] for pid in item_to_presets.get(item_id, []) if pid in preset_vars]
            if containing:
                model.Add(var <= sum(containing))
            else:
                model.Add(var == 0)

    # Constraint 1 & 2: Placement-based mutex and dependency
    #
    # Key insight: An item that can go in multiple slots (e.g., Aimpoint Mount can go on
    # Leapers UTG slot OR on RAP mount's slot) should not be globally mutex'd with items
    # in any of those slots. Instead, we track WHERE each item is actually placed.
    #
    # For items that can only go in ONE slot, we use the simple model (item_var directly).
    # For items that can go in MULTIPLE slots, we create placement variables.

    # First pass: identify which slots each item can go into (only considering available parents)
    item_to_valid_slots = {i: [] for i in item_vars}  # item_id -> list of (slot_id, owner_id, is_base)

    for slot_id, items in slot_items.items():
        owner_id = slot_owner.get(slot_id)
        is_base = (owner_id == weapon_id)

        # Check if slot owner is available (either weapon, or available mod)
        owner_available = is_base or owner_id in item_vars or owner_id in effective_item_vars

        if owner_available:
            for item_id in items:
                if item_id in item_vars:
                    item_to_valid_slots[item_id].append((slot_id, owner_id, is_base))

    # Create placement variables for items with multiple valid slots
    # placed_in[item_id][slot_id] = 1 if item is placed in this specific slot
    placed_in = {}  # item_id -> {slot_id -> BoolVar}
    items_needing_placement = set()

    for item_id, valid_slots in item_to_valid_slots.items():
        if len(valid_slots) > 1:
            # Item can go in multiple slots - need placement variables
            items_needing_placement.add(item_id)
            placed_in[item_id] = {}
            for slot_id, owner_id, is_base in valid_slots:
                placed_in[item_id][slot_id] = model.NewBoolVar(f"placed_{item_id[:8]}_{slot_id[:8]}")

    # Constraint 1a: For items with placement variables, item is selected iff placed somewhere
    for item_id in items_needing_placement:
        placement_vars = list(placed_in[item_id].values())
        # item_var == 1 iff sum(placements) >= 1, and sum(placements) <= 1 (exactly one placement)
        model.Add(sum(placement_vars) == item_vars[item_id])

    # Constraint 1b: Mutex per slot - at most one item in each slot
    # With the new model, x[i] directly represents "in build", so this is simple
    for slot_id, items in slot_items.items():
        slot_placements = []
        for item_id in items:
            if item_id not in x:
                continue
            if item_id in items_needing_placement:
                # Use placement variable for this slot (if it exists)
                if slot_id in placed_in.get(item_id, {}):
                    slot_placements.append(placed_in[item_id][slot_id])
            else:
                # Item only has one valid slot - use x[i] directly
                valid_slots = item_to_valid_slots.get(item_id, [])
                if any(s[0] == slot_id for s in valid_slots):
                    slot_placements.append(x[item_id])

        if slot_placements:
            model.Add(sum(slot_placements) <= 1)

    # Constraint 2: Dependency - placement requires parent to be selected
    item_connected_to_base = {i: False for i in item_vars}

    for item_id, valid_slots in item_to_valid_slots.items():
        if not valid_slots:
            # No valid slots - item cannot be mounted
            model.Add(item_vars[item_id] == 0)
            continue

        has_base_slot = any(is_base for _, _, is_base in valid_slots)
        if has_base_slot:
            item_connected_to_base[item_id] = True

        if item_id in items_needing_placement:
            # For items with placement vars, each placement requires its owner
            for slot_id, owner_id, is_base in valid_slots:
                if slot_id not in placed_in[item_id]:
                    continue
                placement_var = placed_in[item_id][slot_id]

                if not is_base:
                    # Placement requires owner to be selected
                    if owner_id in item_vars:
                        model.Add(placement_var <= item_vars[owner_id])
                    elif owner_id in effective_item_vars:
                        model.Add(placement_var <= effective_item_vars[owner_id])
                    else:
                        # Owner not available - this placement is impossible
                        model.Add(placement_var == 0)
        else:
            # Simple case: item has only one valid slot
            # If that slot is not on the base weapon, require the owner
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
                    # item <= OR(parents)
                    parent_or = model.NewBoolVar(f'parent_or_{item_id}')
                    model.AddMaxEquality(parent_or, parent_vars)
                    model.Add(item_vars[item_id] <= parent_or)

    # Constraint 3: Conflicting items - can't select both
    conflict_pairs_added = set()
    for item_id in available_items:
        if item_id not in item_lookup or item_id not in item_vars:
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
    # 4a: Weapon's required slots - must have at least one item (individual OR preset)
    for slot in weapon["slots"]:
        if slot.get("required", False):
            slot_id = slot["id"]
            items_in_slot = [i for i in slot_items.get(slot_id, []) if i in effective_item_vars]
            if items_in_slot:
                model.Add(sum(effective_item_vars[i] for i in items_in_slot) >= 1)

    # 4b: Mod's required slots - if mod is effectively selected, its required slots must be filled
    for owner_id, slot_ids in compatibility_map["item_to_slots"].items():
        if owner_id not in item_lookup or owner_id not in effective_item_vars:
            continue
        owner_data = item_lookup[owner_id]
        for slot in owner_data.get("slots", []):
            slot_id = slot["id"]
            if slot.get("required", False):
                items_in_slot = [i for i in slot_items.get(slot_id, []) if i in effective_item_vars]
                if items_in_slot:
                    # If owner is effectively selected, slot must have at least one item
                    model.Add(sum(effective_item_vars[i] for i in items_in_slot) >= 1).OnlyEnforceIf(effective_item_vars[owner_id])

    # Helper to build price terms using the new buy[i] variables
    # Cost = base_price (naked or preset) + sum of individually purchased items
    def get_price_terms():
        terms = []

        # 1. Base cost (naked gun or preset)
        # Use fallback price=0 if we're in fallback mode
        if fallback_base and fallback_base["type"] == "naked":
            naked_gun_price = 0  # Fallback naked gun has price=0
        else:
            naked_gun_price = int(weapon["stats"].get("price", 0))
        if "naked" in base_vars:
            terms.append(naked_gun_price * base_vars["naked"])

        for pid in preset_prices_map:
            if pid in base_vars:
                p_price = int(preset_prices_map.get(pid, 0))
                if p_price > 0:
                    terms.append(p_price * base_vars[pid])

        # 2. Individual item costs (using buy[i] - only pay if not covered by preset)
        for item_id in available_items:
            if item_id not in buy:
                continue
            price = int(item_prices[item_id][0])
            if price > 0:
                terms.append(price * buy[item_id])

        return terms

    # Optional: Max price constraint
    if max_price is not None:
        price_terms = get_price_terms()
        if price_terms:
            model.Add(sum(price_terms) <= max_price)

    # Scale factors to handle decimals (multiply by 1000 for precision)
    SCALE = 1000

    # Get weapon base stats
    weapon_naked_ergo = weapon["stats"].get("naked_ergonomics", 0)

    # === ERGONOMICS VARIABLE ===
    # Multiply by 10 to preserve decimal values (e.g., 0.5 -> 5)
    ERGO_SCALE = 10
    ergo_terms = []
    for item_id in available_items:
        if item_id not in item_vars:
            continue
        stats = item_lookup[item_id]["stats"]
        ergo = int(stats.get("ergonomics", 0) * ERGO_SCALE)
        ergo_terms.append(ergo * item_vars[item_id])

    # Total ergo = naked + sum of mod ergonomics (scaled)
    total_ergo_scaled_var = model.NewIntVar(-2000, 3000, "total_ergo_scaled")
    model.Add(total_ergo_scaled_var == weapon_naked_ergo * ERGO_SCALE + sum(ergo_terms))

    # Convert back to regular ergo for constraints
    total_ergo_var = model.NewIntVar(-200, 300, "total_ergo")
    model.AddDivisionEquality(total_ergo_var, total_ergo_scaled_var, ERGO_SCALE)

    # Capped ergo for objective (game caps at 0-100)
    ergo_capped_at_100 = model.NewIntVar(-200, 100, "ergo_capped_at_100")
    model.AddMinEquality(ergo_capped_at_100, [total_ergo_var, model.NewConstant(100)])
    capped_ergo_var = model.NewIntVar(0, 100, "capped_ergo")
    model.AddMaxEquality(capped_ergo_var, [ergo_capped_at_100, model.NewConstant(0)])

    # === RECOIL VARIABLE ===
    recoil_terms = []
    for item_id in available_items:
        if item_id not in item_vars:
            continue
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

    # Maximum final recoil SUM constraint
    if max_recoil_sum is not None:
        naked_recoil_v = weapon["stats"].get("naked_recoil_v", 0)
        naked_recoil_h = weapon["stats"].get("naked_recoil_h", 0)
        naked_sum = naked_recoil_v + naked_recoil_h
        
        if naked_sum > 0:
            max_modifier = int(SCALE * (max_recoil_sum / naked_sum - 1))
            model.Add(total_recoil_var <= max_modifier)

    # Minimum magazine capacity constraint
    # At least one selected magazine must have capacity >= min_mag_capacity
    # Uses effective_item_vars to count items from both individual selection AND presets
    if min_mag_capacity is not None:
        mag_vars_meeting_capacity = []
        for item_id in available_items:
            if item_id not in effective_item_vars:
                continue
            stats = item_lookup[item_id]["stats"]
            capacity = stats.get("capacity", 0)
            if capacity >= min_mag_capacity:
                mag_vars_meeting_capacity.append(effective_item_vars[item_id])
        if mag_vars_meeting_capacity:
            model.Add(sum(mag_vars_meeting_capacity) >= 1)
        else:
            # No magazines meet the capacity requirement - problem is infeasible
            model.Add(0 >= 1)  # Force infeasibility

    # Minimum sighting range constraint
    # At least one selected sight/scope must have sighting_range >= min_sighting_range
    # OR the base gun must have it (if iron sights are assumed retained/sufficient)
    # Uses effective_item_vars to count items from both individual selection AND presets
    if min_sighting_range is not None:
        base_sighting_range = weapon["stats"].get("sighting_range", 0)

        if base_sighting_range < min_sighting_range:
            sight_vars_meeting_range = []
            for item_id in available_items:
                if item_id not in effective_item_vars:
                    continue
                stats = item_lookup[item_id]["stats"]
                sighting_range = stats.get("sighting_range", 0)
                if sighting_range >= min_sighting_range:
                    sight_vars_meeting_range.append(effective_item_vars[item_id])
            if sight_vars_meeting_range:
                model.Add(sum(sight_vars_meeting_range) >= 1)
            else:
                # No sights meet the range requirement - problem is infeasible
                model.Add(0 >= 1)  # Force infeasibility

    # Maximum weight constraint
    # Total weight of base weapon + selected mods must not exceed max_weight
    if max_weight is not None:
        # Use grams (integers) for constraint precision
        WEIGHT_SCALE = 1000  # Convert kg to grams
        base_weight_g = int(weapon["stats"].get("weight", 0) * WEIGHT_SCALE)
        max_weight_g = int(max_weight * WEIGHT_SCALE)

        weight_terms = []
        for item_id in available_items:
            if item_id not in item_vars:
                continue
            stats = item_lookup[item_id]["stats"]
            weight_g = int(stats.get("weight", 0) * WEIGHT_SCALE)
            if weight_g > 0:
                weight_terms.append(weight_g * item_vars[item_id])

        if weight_terms:
            model.Add(base_weight_g + sum(weight_terms) <= max_weight_g)

    # === OBJECTIVE FUNCTION ===
    objective_terms = []

    # === COMBINED WEIGHTED OBJECTIVE ===
    # Ergonomics: higher is better (use capped value)
    objective_terms.append(int(ergo_weight * SCALE) * capped_ergo_var)

    # Recoil: more negative is better (negate to maximize reduction)
    objective_terms.append(int(-recoil_weight * SCALE) * total_recoil_var)

    # Price: lower is better (subtract from objective)
    # Uses the new model: base cost + buy[i] for individual items
    if price_weight > 0:
        # Base cost (naked gun or preset)
        # Use fallback price=0 if we're in fallback mode
        if fallback_base and fallback_base["type"] == "naked":
            naked_gun_price = 0  # Fallback naked gun has price=0
        else:
            naked_gun_price = int(weapon["stats"].get("price", 0))
        if "naked" in base_vars:
            objective_terms.append(int(-price_weight * naked_gun_price) * base_vars["naked"])

        for pid in preset_prices_map:
            if pid in base_vars:
                p_price = int(preset_prices_map.get(pid, 0))
                if p_price > 0:
                    objective_terms.append(int(-price_weight * p_price) * base_vars[pid])

        # Individual item costs (only pay if not covered by preset)
        for item_id in available_items:
            if item_id not in buy:
                continue
            item_price = int(item_prices.get(item_id, (0, None))[0])
            if item_price > 0:
                objective_terms.append(int(-price_weight * item_price) * buy[item_id])

    model.Maximize(sum(objective_terms))

    # Solve
    logger.debug(f"Model built with {len(x)} item variables, {len(base_vars)} base options")
    logger.info("Running CP-SAT solver...")
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 120.0

    start_time = time.time()
    status = solver.Solve(model)
    solve_time = time.time() - start_time
    logger.debug(f"Solver finished in {solve_time:.2f}s")

    if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
        # Get items in the build (x[i] = 1)
        selected = []
        for item_id, var in x.items():
            if solver.Value(var) == 1:
                selected.append(item_id)

        # Check which base was selected (naked or preset)
        selected_preset = None
        selected_base = None
        for base_id, var in base_vars.items():
            if solver.Value(var) == 1:
                selected_base = base_id
                if base_id != "naked":
                    selected_preset = base_id
                break

        status_str = "optimal" if status == cp_model.OPTIMAL else "feasible"
        logger.info(f"Optimization {status_str}: selected {len(selected)} mods, objective={solver.ObjectiveValue():.0f}")
        if selected_preset:
            logger.debug(f"Selected preset: {selected_preset}")
        if fallback_base:
            logger.info(f"Using fallback base with price=0: {fallback_base}")
        return {
            "status": status_str,
            "selected_items": selected,
            "selected_preset": selected_preset,
            "fallback_base": fallback_base,  # Info about fallback base if used (price=0)
            "objective_value": solver.ObjectiveValue(),
        }
    else:
        # Solver failed - likely due to stat constraints (min_ergo, max_recoil)
        reason = "No valid configuration found"
        if min_ergonomics is not None:
            reason += f" (cannot achieve {min_ergonomics} ergonomics)"
        if max_recoil_sum is not None:
            reason += f" (cannot reduce recoil to {max_recoil_sum})"
        logger.warning(f"Optimization failed: {reason}")
        return {
            "status": "infeasible",
            "reason": reason,
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
    logger.info("=" * 60)
    logger.info("TARKOV WEAPON MOD OPTIMIZER")
    logger.info("=" * 60)

    guns, mods = fetch_all_data()

    # Step 2: Build item lookup dictionary
    item_lookup = build_item_lookup(guns, mods)

    # Step 3: Select the first gun for testing
    test_gun = guns[0]
    weapon_id = test_gun["id"]
    logger.info(f"Test weapon: {test_gun['name']} (ID: {weapon_id})")

    # Step 4: Build compatibility map via BFS
    compat_map = build_compatibility_map(weapon_id, item_lookup)

    # Show weapon's slots
    weapon = item_lookup[weapon_id]
    logger.debug("Weapon slots:")
    for slot in weapon["slots"]:
        slot_id = slot["id"]
        num_options = len(compat_map["slot_items"].get(slot_id, []))
        required = "REQUIRED" if slot.get("required") else "optional"
        logger.debug(f"  - {slot['nameId']}: {num_options} options ({required})")

    # Step 5: Run optimization
    logger.info("=" * 60)
    logger.info("RUNNING OPTIMIZATION...")
    logger.info("=" * 60)

    # Optimize for lowest recoil (no constraints)
    logger.info(">>> Optimizing for LOWEST RECOIL <<<")
    result = optimize_weapon(
        weapon_id,
        item_lookup,
        compat_map,
        ergo_weight=0, recoil_weight=1, price_weight=0,
    )

    if result["selected_items"]:
        print_build(weapon_id, result["selected_items"], item_lookup, weapon["stats"])

    # Optimize for highest ergonomics
    logger.info(">>> Optimizing for HIGHEST ERGONOMICS <<<")
    result_ergo = optimize_weapon(
        weapon_id,
        item_lookup,
        compat_map,
        ergo_weight=1, recoil_weight=0, price_weight=0,
    )

    if result_ergo["selected_items"]:
        print_build(weapon_id, result_ergo["selected_items"], item_lookup, weapon["stats"])

    # Lowest recoil with minimum ergonomics constraint
    logger.info(">>> Optimizing for LOWEST RECOIL with MIN ERGO=50 <<<")
    result_balanced = optimize_weapon(
        weapon_id,
        item_lookup,
        compat_map,
        ergo_weight=0, recoil_weight=1, price_weight=0,
        min_ergonomics=50,
    )

    if result_balanced["selected_items"]:
        print_build(weapon_id, result_balanced["selected_items"], item_lookup, weapon["stats"])

    # Budget build
    logger.info(">>> Optimizing for BUDGET BUILD (max 300,000 roubles) <<<")
    result_budget = optimize_weapon(
        weapon_id,
        item_lookup,
        compat_map,
        ergo_weight=0, recoil_weight=1, price_weight=0,
        max_price=300000,
    )

    if result_budget["selected_items"]:
        print_build(weapon_id, result_budget["selected_items"], item_lookup, weapon["stats"])


if __name__ == "__main__":
    main()
