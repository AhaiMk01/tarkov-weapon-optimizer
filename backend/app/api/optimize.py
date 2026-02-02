import time
import traceback
from fastapi import APIRouter, HTTPException
from loguru import logger

from ..models.schemas import OptimizeRequest, OptimizeResponse
from ..state import get_state
from ..services.optimizer import build_compatibility_map, optimize_weapon

router = APIRouter()


@router.post("", response_model=OptimizeResponse)
def run_optimization(req: OptimizeRequest, lang: str = "en", game_mode: str = "regular"):
    current_state = get_state(lang, game_mode)
    item_lookup = current_state["item_lookup"]
    compat_maps = current_state["compat_maps"]
    if req.weapon_id not in item_lookup:
        raise HTTPException(status_code=404, detail=f"Weapon {req.weapon_id} not found")
    if req.weapon_id not in compat_maps:
        logger.info(f"Building compat map for {req.weapon_id} [{lang}]")
        compat_maps[req.weapon_id] = build_compatibility_map(req.weapon_id, item_lookup)
    compat_map = compat_maps[req.weapon_id]
    trader_levels_dict = req.trader_levels.dict() if req.trader_levels else None
    try:
        start_time = time.time()
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
        solve_time_ms = (time.time() - start_time) * 1000
        result["solve_time_ms"] = round(solve_time_ms, 2)
        return OptimizeResponse(**result)
    except Exception as e:
        logger.error(f"Optimization error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
