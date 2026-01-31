import sys
import os

# Add the parent directory of 'app' to sys.path so we can import 'app.services.optimizer'
sys.path.append(os.path.join(os.path.dirname(__file__)))

from app.services.optimizer import fetch_all_data, build_item_lookup, build_compatibility_map, optimize_weapon

def test_logic():
    print("Fetching data...")
    guns, mods = fetch_all_data()
    print(f"Loaded {len(guns)} guns, {len(mods)} mods")
    
    lookup = build_item_lookup(guns, mods)
    
    # Use the first gun
    test_gun = guns[0]
    weapon_id = test_gun["id"]
    print(f"Testing weapon: {test_gun['name']} ({weapon_id})")
    
    compat_map = build_compatibility_map(weapon_id, lookup)
    print(f"Compat map built: {len(compat_map['reachable_items'])} mods")
    
    print("Running optimization (lowest recoil)...")
    result = optimize_weapon(
        weapon_id=weapon_id,
        item_lookup=lookup,
        compatibility_map=compat_map,
        ergo_weight=0,
        recoil_weight=1,
        price_weight=0
    )
    
    print(f"Status: {result['status']}")
    print(f"Selected {len(result['selected_items'])} items")
    if result['selected_preset']:
        print(f"Preset: {result['selected_preset']}")

if __name__ == "__main__":
    test_logic()
