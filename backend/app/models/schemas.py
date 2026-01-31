from pydantic import BaseModel
from typing import List, Optional, Dict, Any

class TraderLevels(BaseModel):
    prapor: int = 4
    skier: int = 4
    peacekeeper: int = 4
    mechanic: int = 4
    jaeger: int = 4

class OptimizeRequest(BaseModel):
    weapon_id: str
    max_price: Optional[int] = None
    min_ergonomics: Optional[int] = None
    max_recoil_v: Optional[int] = None
    max_recoil_sum: Optional[int] = None
    min_mag_capacity: Optional[int] = None
    min_sighting_range: Optional[int] = None
    max_weight: Optional[float] = None
    
    include_items: Optional[List[str]] = None
    exclude_items: Optional[List[str]] = None
    include_categories: Optional[List[List[str]]] = None
    exclude_categories: Optional[List[str]] = None
    
    ergo_weight: float = 1.0
    recoil_weight: float = 1.0
    price_weight: float = 0.0
    
    trader_levels: Optional[TraderLevels] = None
    flea_available: bool = True
    player_level: Optional[int] = None

class FinalStats(BaseModel):
    ergonomics: float
    recoil_vertical: float
    recoil_horizontal: float
    total_price: int
    total_weight: float

class ItemDetail(BaseModel):
    id: str
    name: str
    price: int
    icon: Optional[str] = None
    source: Optional[str] = None
    ergonomics: float = 0.0
    recoil_modifier: float = 0.0

class PresetDetail(BaseModel):
    id: str
    name: str
    price: int
    items: List[str]
    icon: Optional[str] = None
    source: Optional[str] = None

class OptimizeResponse(BaseModel):
    status: str
    selected_items: List[ItemDetail]  # Changed from List[str] to detailed list
    selected_preset: Optional[PresetDetail] = None
    fallback_base: Optional[Dict[str, Any]] = None
    objective_value: float
    reason: Optional[str] = None
    final_stats: Optional[FinalStats] = None  # New field

class ExploreRequest(OptimizeRequest):
    ignore: str = "price"  # "price", "recoil", or "ergo"
    steps: int = 10

class ExplorePoint(BaseModel):
    ergo: float
    recoil_pct: float
    recoil_v: float
    recoil_h: float
    price: int
    selected_items: List[ItemDetail]
    selected_preset: Optional[PresetDetail] = None
    status: str

class ExploreResponse(BaseModel):
    points: List[ExplorePoint]

class Gun(BaseModel):
    id: str
    name: str
    image: Optional[str] = None
    category: str
    caliber: str

class InfoResponse(BaseModel):
    guns: List[Gun]

# Gunsmith Task models
class GunsmithConstraints(BaseModel):
    min_ergonomics: Optional[int] = None
    max_recoil_sum: Optional[int] = None
    min_mag_capacity: Optional[int] = None
    min_sighting_range: Optional[int] = None
    max_weight: Optional[float] = None

class GunsmithTask(BaseModel):
    task_name: str
    weapon_id: str
    weapon_name: Optional[str] = None
    weapon_image: Optional[str] = None
    constraints: GunsmithConstraints
    required_item_ids: List[str] = []
    required_item_names: List[str] = []  # Resolved names
    required_category_group_ids: List[List[str]] = []
    required_category_names: List[List[str]] = []  # Resolved names

class GunsmithTasksResponse(BaseModel):
    tasks: List[GunsmithTask]