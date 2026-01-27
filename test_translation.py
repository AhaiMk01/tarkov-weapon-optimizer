import requests
import json

API_URL = "https://api.tarkov.dev/graphql"

query = """
query MyQuery($lang: LanguageCode) {
  items(lang: $lang) {
    id
    name
    shortName
  }
}
"""

variables = {"lang": "es"}

print(f"Sending query with variables: {variables}")

try:
    resp = requests.post(
        API_URL,
        json={"query": query, "variables": variables},
        timeout=30,
        headers={"Content-Type": "application/json"},
    )
    print(f"Status: {resp.status_code}")
    data = resp.json()
    if "errors" in data:
        print("Errors:", data["errors"])
    else:
        items = data.get("data", {}).get("items", [])
        print(f"Success! Got {len(items)} items.")
        
        for item in items:
            if "Zenit" in item["name"]:
                print(f"Found Zenit: {item}")
                if "RK-2" in item["name"]:
                     print("!!! FOUND RK-2 !!!")
                     found = True
                     break
        
        if not found:
            print("RK-2 not found in translation items!")
            if items:
                print("Sample item:", items[0])
except Exception as e:
    print(f"Exception: {e}")
