from fastapi import APIRouter, HTTPException

from ..models.schemas import InfoResponse, Gun
from ..state import get_state
from ..services.optimizer import build_compatibility_map

router = APIRouter()


@router.get("", response_model=InfoResponse)
def get_info(lang: str = "en", game_mode: str = "regular"):
    current_state = get_state(lang, game_mode)
    guns = current_state["guns"]
    gun_list = []
    for gun in guns:
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
    gun_list.sort(key=lambda x: x.name)
    return InfoResponse(guns=gun_list)


@router.get("/{weapon_id}/mods")
def get_weapon_mods(weapon_id: str, lang: str = "en", game_mode: str = "regular"):
    current_state = get_state(lang, game_mode)
    item_lookup = current_state["item_lookup"]
    compat_maps = current_state["compat_maps"]
    if weapon_id not in item_lookup:
        raise HTTPException(status_code=404, detail="Weapon not found")
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
