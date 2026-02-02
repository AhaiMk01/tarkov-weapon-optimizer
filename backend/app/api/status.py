from fastapi import APIRouter

from ..state import get_state

router = APIRouter()


@router.get("")
def get_status(lang: str = "en", game_mode: str = "regular"):
    try:
        current_state = get_state(lang, game_mode)
        return {"timestamp": current_state.get("timestamp", 0)}
    except Exception:
        return {"timestamp": 0}
