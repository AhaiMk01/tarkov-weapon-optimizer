import json
import time
from typing import Optional
import redis
from loguru import logger

from .config import get_settings
from .services.optimizer import (
    fetch_all_data,
    build_item_lookup,
    CACHE_VERSION
)

SUPPORTED_LANGUAGES = ["en", "ru", "zh", "es", "de", "fr", "it", "ja", "ko", "pl", "pt", "tr", "cs", "hu", "ro", "sk"]
SUPPORTED_GAME_MODES = ["regular", "pve"]


class AppState:
    data: dict = {}
    gunsmith_tasks: list = []
    redis_client: Optional[redis.Redis] = None


state = AppState()


def get_redis() -> Optional[redis.Redis]:
    if state.redis_client is None:
        settings = get_settings()
        try:
            state.redis_client = redis.Redis(
                host=settings.redis_host,
                port=settings.redis_port,
                db=settings.redis_db,
                password=settings.redis_password or None,
                decode_responses=True
            )
            state.redis_client.ping()
            logger.info(f"Redis connected: {settings.redis_host}:{settings.redis_port}")
        except Exception as e:
            logger.warning(f"Redis unavailable: {e}, using memory cache only")
            state.redis_client = None
    return state.redis_client


def _redis_key(prefix: str, lang: str, game_mode: str) -> str:
    return f"tarkov:{prefix}:{lang}:{game_mode}:v{CACHE_VERSION}"


def _get_from_redis(key: str) -> Optional[dict]:
    r = get_redis()
    if r is None:
        return None
    try:
        data = r.get(key)
        if data:
            return json.loads(data)
    except Exception as e:
        logger.warning(f"Redis get error: {e}")
    return None


def _set_to_redis(key: str, data: dict, ttl: int | None = None):
    r = get_redis()
    if r is None:
        return
    if ttl is None:
        ttl = get_settings().cache_ttl
    try:
        r.setex(key, ttl, json.dumps(data, ensure_ascii=False))
    except Exception as e:
        logger.warning(f"Redis set error: {e}")


def load_language_data(lang: str, game_mode: str = "regular") -> dict:
    cache_key = _redis_key("data", lang, game_mode)
    cached = _get_from_redis(cache_key)
    if cached:
        logger.info(f"Loaded {lang}/{game_mode} from Redis cache")
        cached["compat_maps"] = {}
        return cached
    logger.info(f"Building data for {lang}/{game_mode}...")
    guns, mods = fetch_all_data(lang=lang, game_mode=game_mode)
    lookup = build_item_lookup(guns, mods)
    timestamp = time.time()
    data = {
        "guns": guns,
        "mods": mods,
        "item_lookup": lookup,
        "compat_maps": {},
        "timestamp": timestamp
    }
    cache_data = {
        "guns": guns,
        "mods": mods,
        "item_lookup": lookup,
        "timestamp": timestamp
    }
    _set_to_redis(cache_key, cache_data)
    return data


def get_state(lang: str, game_mode: str = "regular"):
    short_lang = lang.split('-')[0] if '-' in lang else lang
    if short_lang not in SUPPORTED_LANGUAGES:
        short_lang = "en"
    if game_mode not in SUPPORTED_GAME_MODES:
        game_mode = "regular"
    key = (short_lang, game_mode)
    if key in state.data:
        return state.data[key]
    logger.info(f"Loading data on-demand for {short_lang}/{game_mode}...")
    try:
        data = load_language_data(short_lang, game_mode)
        state.data[key] = data
        return data
    except Exception as e:
        logger.error(f"Failed to load {short_lang}/{game_mode}: {e}")
        fallback_key = ("en", "regular")
        if fallback_key in state.data:
            return state.data[fallback_key]
        raise


def load_gunsmith_tasks() -> list:
    from pathlib import Path
    potential_paths = [
        Path(__file__).parent.parent.parent / "tasks.json",
        Path(__file__).parent.parent / "tasks.json",
        Path("tasks.json"),
    ]
    for path in potential_paths:
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    logger.warning("tasks.json not found")
    return []


async def startup():
    start_total = time.time()
    get_redis()
    state.gunsmith_tasks = load_gunsmith_tasks()
    logger.info(f"Loaded {len(state.gunsmith_tasks)} gunsmith tasks")
    for game_mode in SUPPORTED_GAME_MODES:
        try:
            start_mode = time.time()
            data = load_language_data("en", game_mode)
            state.data[("en", game_mode)] = data
            logger.info(f"Ready: en/{game_mode} in {time.time() - start_mode:.2f}s ({len(data['guns'])} guns)")
        except Exception as e:
            logger.error(f"Startup failed for en/{game_mode}: {e}")
    logger.info(f"Startup complete in {time.time() - start_total:.2f}s")


async def shutdown():
    state.data.clear()
    if state.redis_client:
        state.redis_client.close()
