from fastapi import APIRouter

from ..models.schemas import GunsmithTasksResponse, GunsmithTask, GunsmithConstraints
from ..state import get_state, state

router = APIRouter()


@router.get("/tasks", response_model=GunsmithTasksResponse)
def get_gunsmith_tasks(lang: str = "en", game_mode: str = "regular"):
    current_state = get_state(lang, game_mode)
    item_lookup = current_state["item_lookup"]
    category_id_to_name = {}
    for item_id, item in item_lookup.items():
        cat_id = item.get("stats", {}).get("category_id", "")
        cat_name = item.get("stats", {}).get("category", "")
        if cat_id and cat_name:
            category_id_to_name[cat_id] = cat_name
    tasks = []
    for raw in state.gunsmith_tasks:
        weapon_id = raw.get("weapon_id", "")
        weapon_data = item_lookup.get(weapon_id, {})
        weapon_info = weapon_data.get("data", {})
        props = weapon_info.get("properties", {}) or {}
        default_preset = props.get("defaultPreset") or {}
        weapon_image = (
            default_preset.get("image512pxLink") or
            default_preset.get("imageLink") or
            weapon_info.get("image512pxLink") or
            weapon_info.get("imageLink") or
            weapon_info.get("iconLink")
        )
        required_item_ids = raw.get("required_item_ids", [])
        required_item_names = []
        for item_id in required_item_ids:
            item_data = item_lookup.get(item_id, {})
            name = item_data.get("data", {}).get("name", item_id)
            required_item_names.append(name)
        required_category_group_ids = raw.get("required_category_group_ids", [])
        required_category_names = []
        for group in required_category_group_ids:
            group_names = []
            for cat_id in group:
                cat_name = category_id_to_name.get(cat_id, cat_id)
                group_names.append(cat_name)
            required_category_names.append(group_names)
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
