from fastapi import APIRouter

from .info import router as info_router
from .optimize import router as optimize_router
from .explore import router as explore_router
from .gunsmith import router as gunsmith_router
from .status import router as status_router

api_router = APIRouter()

api_router.include_router(info_router, prefix="/info", tags=["info"])
api_router.include_router(optimize_router, prefix="/optimize", tags=["optimize"])
api_router.include_router(explore_router, prefix="/explore", tags=["explore"])
api_router.include_router(gunsmith_router, prefix="/gunsmith", tags=["gunsmith"])
api_router.include_router(status_router, prefix="/status", tags=["status"])
