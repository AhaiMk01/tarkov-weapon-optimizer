from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from loguru import logger
import time
import traceback
import json
import os
import hashlib
from pathlib import Path

from .models.schemas import (
    OptimizeRequest, OptimizeResponse, InfoResponse, Gun,
    ExploreRequest, ExploreResponse, ExplorePoint,
    GunsmithTask, GunsmithTasksResponse, GunsmithConstraints
)
from .services.optimizer import (
    fetch_all_data,
    build_item_lookup,
    build_compatibility_map,
    optimize_weapon,
    explore_pareto,
    CACHE_DIR,
    CACHE_TTL,
    CACHE_VERSION
)

SUPPORTED_LANGUAGES = ["en", "ru", "zh", "es", "de", "fr", "it", "ja", "ko", "pl", "pt", "tr", "cs", "hu", "ro", "sk"]
SUPPORTED_GAME_MODES = ["regular", "pve"]

# Global state
class AppState:
    data: dict = {}  # (lang, game_mode) -> {guns, mods, item_lookup, compat_maps}

state = AppState()

def _get_processed_cache_path(lang: str, game_mode: str = "regular") -> str:
    """Get cache path for processed item_lookup data."""
    key = hashlib.md5(f"processed_{lang}_{game_mode}_v{CACHE_VERSION}".encode()).hexdigest()
    return os.path.join(CACHE_DIR, f"processed_{key}.json")

def _load_processed_cache(lang: str, game_mode: str = "regular"):
    """Load cached processed data if valid."""
    cache_path = _get_processed_cache_path(lang, game_mode)
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

def _save_processed_cache(lang: str, data: dict, game_mode: str = "regular"):
    """Save processed data to cache."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_path = _get_processed_cache_path(lang, game_mode)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump({"timestamp": time.time(), "version": CACHE_VERSION, "data": data}, f)

def load_language_data(lang: str, game_mode: str = "regular") -> dict:
    """Load data for a language, using cache if available."""
    # Try processed cache first
    cached = _load_processed_cache(lang, game_mode)
    if cached:
        logger.info(f"Loaded {lang} from processed cache")
        return cached

    # Fetch and process
    logger.info(f"Building data for {lang}...")
    guns, mods = fetch_all_data(lang=lang, game_mode=game_mode)
    lookup = build_item_lookup(guns, mods)

    data = {
        "guns": guns,
        "mods": mods,
        "item_lookup": lookup,
        "compat_maps": {}
    }

    # Save to cache (without compat_maps which are built on-demand)
    cache_data = {
        "guns": guns,
        "mods": mods,
        "item_lookup": lookup,
    }
    _save_processed_cache(lang, cache_data, game_mode)

    return data

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load data on startup - only load English for both game modes to be quick
    # Other languages/modes loaded on-demand
    start_total = time.time()

    for game_mode in SUPPORTED_GAME_MODES:
        try:
            start_mode = time.time()
            data = load_language_data("en", game_mode)
            data["compat_maps"] = {}
            state.data[("en", game_mode)] = data
            logger.info(f"Ready: en/{game_mode} in {time.time() - start_mode:.2f}s ({len(data['guns'])} guns)")
        except Exception as e:
            logger.error(f"Startup failed for en/{game_mode}: {e}")

    logger.info(f"Startup complete in {time.time() - start_total:.2f}s. Other langs loaded on-demand.")
    yield
    # Cleanup on shutdown
    state.data.clear()

app = FastAPI(title="Tarkov Optimizer API", lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For dev, allow all. In prod, lock to frontend domain.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_state(lang: str, game_mode: str = "regular"):
    """Get state for language and game mode, loading on-demand if needed."""
    # Normalize inputs
    short_lang = lang.split('-')[0] if '-' in lang else lang
    if short_lang not in SUPPORTED_LANGUAGES:
        short_lang = "en"
    if game_mode not in SUPPORTED_GAME_MODES:
        game_mode = "regular"

    key = (short_lang, game_mode)

    # Return if already loaded
    if key in state.data:
        return state.data[key]

    # Load on-demand
    logger.info(f"Loading data on-demand for {short_lang}/{game_mode}...")
    try:
        data = load_language_data(short_lang, game_mode)
        data["compat_maps"] = {}
        state.data[key] = data
        return data
    except Exception as e:
        logger.error(f"Failed to load {short_lang}/{game_mode}: {e}")
        # Fallback to English regular
        fallback_key = ("en", "regular")
        if fallback_key in state.data:
            return state.data[fallback_key]
        raise HTTPException(status_code=503, detail="Server data not loaded")

@app.get("/")
def read_root():
    loaded = [f"{lang}/{mode}" for (lang, mode) in state.data.keys()]
    return {"status": "ok", "message": "Tarkov Weapon Optimizer API is running", "loaded": loaded, "game_modes": SUPPORTED_GAME_MODES}

@app.get("/api/info", response_model=InfoResponse)
def get_info(lang: str = "en", game_mode: str = "regular"):
    """Return list of available guns for the frontend to populate dropdowns."""
    current_state = get_state(lang, game_mode)
    guns = current_state["guns"]
    
    gun_list = []
    for gun in guns:
        # Extract simple info
        props = gun.get("properties", {}) or {}
        default_preset = props.get("defaultPreset") or {}
        image = (
            default_preset.get("image512pxLink") or
            default_preset.get("imageLink") or
            gun.get("image512pxLink") or
            gun.get("imageLink") or
            gun.get("iconLink")
        )
        gun_list.append(Gun(
            id=gun["id"],
            name=gun["name"],
            image=image,
            category=gun.get("bsgCategory", {}).get("name", "Unknown"),
            caliber=props.get("caliber", "").replace("Caliber", "").strip()
        ))
    
    # Sort by name
    gun_list.sort(key=lambda x: x.name)
    return InfoResponse(guns=gun_list)

@app.get("/api/info/{weapon_id}/mods")
def get_weapon_mods(weapon_id: str, lang: str = "en", game_mode: str = "regular"):
    """Return all compatible mods for a specific weapon."""
    current_state = get_state(lang, game_mode)
    item_lookup = current_state["item_lookup"]
    compat_maps = current_state["compat_maps"]
    
    if weapon_id not in item_lookup:
        raise HTTPException(status_code=404, detail="Weapon not found")
    
    # Build or get compat map
    if weapon_id not in compat_maps:
        compat_maps[weapon_id] = build_compatibility_map(weapon_id, item_lookup)
    
    compat_map = compat_maps[weapon_id]
    reachable_ids = compat_map["reachable_items"].keys()
    
    mod_list = []
    for mid in reachable_ids:
        item = item_lookup[mid]
        data = item["data"]
        mod_list.append({
            "id": mid,
            "name": data.get("name"),
            "category": item["stats"].get("category", "Unknown"),
            "icon": (data.get("iconLink") or data.get("imageLink"))
        })
    
    mod_list.sort(key=lambda x: x["name"])
    return {"mods": mod_list}

@app.post("/api/optimize", response_model=OptimizeResponse)
def run_optimization(req: OptimizeRequest, lang: str = "en", game_mode: str = "regular"):
    current_state = get_state(lang, game_mode)
    item_lookup = current_state["item_lookup"]
    compat_maps = current_state["compat_maps"]

    if req.weapon_id not in item_lookup:
        raise HTTPException(status_code=404, detail=f"Weapon {req.weapon_id} not found")

    # Get or build compatibility map
    if req.weapon_id not in compat_maps:
        logger.info(f"Building compat map for {req.weapon_id} [{lang}]")
        compat_maps[req.weapon_id] = build_compatibility_map(req.weapon_id, item_lookup)
    
    compat_map = compat_maps[req.weapon_id]
    
    # Convert Pydantic model to dict for kwargs
    trader_levels_dict = req.trader_levels.dict() if req.trader_levels else None
    
    try:
        result = optimize_weapon(
            weapon_id=req.weapon_id,
            item_lookup=item_lookup,
            compatibility_map=compat_map,
            max_price=req.max_price,
            min_ergonomics=req.min_ergonomics,
            max_recoil_v=req.max_recoil_v,
            max_recoil_sum=req.max_recoil_sum,
            min_mag_capacity=req.min_mag_capacity,
            min_sighting_range=req.min_sighting_range,
            max_weight=req.max_weight,
            include_items=set(req.include_items) if req.include_items else None,
            exclude_items=set(req.exclude_items) if req.exclude_items else None,
            include_categories=req.include_categories,
            exclude_categories=set(req.exclude_categories) if req.exclude_categories else None,
            ergo_weight=req.ergo_weight,
            recoil_weight=req.recoil_weight,
            price_weight=req.price_weight,
            trader_levels=trader_levels_dict,
            flea_available=req.flea_available,
            player_level=req.player_level
        )
        return OptimizeResponse(**result)
    except Exception as e:
        logger.error(f"Optimization error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/explore", response_model=ExploreResponse)
def run_exploration(req: ExploreRequest, lang: str = "en", game_mode: str = "regular"):
    current_state = get_state(lang, game_mode)
    item_lookup = current_state["item_lookup"]
    compat_maps = current_state["compat_maps"]

    if req.weapon_id not in item_lookup:
        raise HTTPException(status_code=404, detail=f"Weapon {req.weapon_id} not found")

    # Get or build compatibility map
    if req.weapon_id not in compat_maps:
        compat_maps[req.weapon_id] = build_compatibility_map(req.weapon_id, item_lookup)
    
    compat_map = compat_maps[req.weapon_id]
    
    trader_levels_dict = req.trader_levels.dict() if req.trader_levels else None
    
    try:
        frontier = explore_pareto(
            weapon_id=req.weapon_id,
            item_lookup=item_lookup,
            compatibility_map=compat_map,
            ignore=req.ignore,
            steps=req.steps,
            max_price=req.max_price,
            min_ergonomics=req.min_ergonomics,
            max_recoil_v=req.max_recoil_v,
            max_recoil_sum=req.max_recoil_sum,
            min_mag_capacity=req.min_mag_capacity,
            min_sighting_range=req.min_sighting_range,
            max_weight=req.max_weight,
            include_items=set(req.include_items) if req.include_items else None,
            exclude_items=set(req.exclude_items) if req.exclude_items else None,
            include_categories=req.include_categories,
            exclude_categories=set(req.exclude_categories) if req.exclude_categories else None,
            trader_levels=trader_levels_dict,
            flea_available=req.flea_available,
            player_level=req.player_level
        )
        return ExploreResponse(points=[ExplorePoint(**p) for p in frontier])
    except Exception as e:
        logger.error(f"Exploration error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

def load_gunsmith_tasks() -> list:
    """Load Gunsmith tasks from JSON file."""
    # Try multiple potential locations
    potential_paths = [
        Path(__file__).parent.parent.parent.parent / "tasks.json",  # project root
        Path(__file__).parent.parent.parent / "tasks.json",  # backend folder
        Path("tasks.json"),  # current working directory
    ]

    for path in potential_paths:
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)

    logger.warning("tasks.json not found in any expected location")
    return []

@app.get("/api/gunsmith/tasks", response_model=GunsmithTasksResponse)
def get_gunsmith_tasks(lang: str = "en", game_mode: str = "regular"):
    """Return all Gunsmith tasks with resolved item/weapon names."""
    current_state = get_state(lang, game_mode)
    item_lookup = current_state["item_lookup"]

    # Build category ID -> name mapping from items
    category_id_to_name = {}
    for item_id, item in item_lookup.items():
        cat_id = item.get("stats", {}).get("category_id", "")
        cat_name = item.get("stats", {}).get("category", "")
        if cat_id and cat_name:
            category_id_to_name[cat_id] = cat_name

    raw_tasks = load_gunsmith_tasks()
    tasks = []

    for raw in raw_tasks:
        weapon_id = raw.get("weapon_id", "")
        weapon_data = item_lookup.get(weapon_id, {})
        weapon_info = weapon_data.get("data", {})

        # Get weapon image
        props = weapon_info.get("properties", {}) or {}
        default_preset = props.get("defaultPreset") or {}
        weapon_image = (
            default_preset.get("image512pxLink") or
            default_preset.get("imageLink") or
            weapon_info.get("image512pxLink") or
            weapon_info.get("imageLink") or
            weapon_info.get("iconLink")
        )

        # Resolve required item names
        required_item_ids = raw.get("required_item_ids", [])
        required_item_names = []
        for item_id in required_item_ids:
            item_data = item_lookup.get(item_id, {})
            name = item_data.get("data", {}).get("name", item_id)
            required_item_names.append(name)

        # Resolve category group names using the category mapping
        required_category_group_ids = raw.get("required_category_group_ids", [])
        required_category_names = []
        for group in required_category_group_ids:
            group_names = []
            for cat_id in group:
                cat_name = category_id_to_name.get(cat_id, cat_id)
                group_names.append(cat_name)
            required_category_names.append(group_names)

        # Build constraints
        raw_constraints = raw.get("constraints", {})
        constraints = GunsmithConstraints(
            min_ergonomics=raw_constraints.get("min_ergonomics"),
            max_recoil_sum=raw_constraints.get("max_recoil_sum"),
            min_mag_capacity=raw_constraints.get("min_mag_capacity"),
            min_sighting_range=raw_constraints.get("min_sighting_range"),
            max_weight=raw_constraints.get("max_weight"),
        )

        tasks.append(GunsmithTask(
            task_name=raw.get("task_name", "Unknown Task"),
            weapon_id=weapon_id,
            weapon_name=weapon_info.get("name", "Unknown Weapon"),
            weapon_image=weapon_image,
            constraints=constraints,
            required_item_ids=required_item_ids,
            required_item_names=required_item_names,
            required_category_group_ids=required_category_group_ids,
            required_category_names=required_category_names,
        ))

    return GunsmithTasksResponse(tasks=tasks)

if __name__ == "__main__":
    import uvicorn
    # Use standard uvicorn run for dev
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)
