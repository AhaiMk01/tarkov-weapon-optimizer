"""
GraphQL queries for the Tarkov.dev API.
"""

# Query to fetch all guns with their slots (with language and gameMode support)
GUNS_QUERY = """
query AllGuns($lang: LanguageCode, $gameMode: GameMode) {
  items(gameMode: $gameMode, lang: $lang, types: gun) {
    id
    basePrice
    avg24hPrice
    buyFor {
      currency
      priceRUB
      source
      vendor {
        name
        normalizedName
        ... on TraderOffer {
          minTraderLevel
          buyLimit
        }
        ... on FleaMarket {
          foundInRaidRequired
        }
      }
    }
    accuracyModifier
    conflictingSlotIds
    ergonomicsModifier
    recoilModifier
    name
    normalizedName
    shortName
    weight
    width
    height
    image8xLink
    image512pxLink
    imageLink
    iconLinkFallback
    iconLink
    bsgCategory {
      id
      name
    }
    properties {
      ... on ItemPropertiesWeapon {
        caliber
        effectiveDistance
        sightingRange
        fireRate
        fireModes
        cameraSnap
        centerOfImpact
        deviationMax
        deviationCurve
        recoilAngle
        recoilDispersion
        ergonomics
        defaultErgonomics
        recoilVertical
        recoilHorizontal
        defaultRecoilVertical
        defaultRecoilHorizontal
        presets {
          id
          name
          shortName
          baseImageLink
          gridImageLinkFallback
          gridImageLink
          imageLink
          image8xLink
          image512pxLink
          imageLinkFallback
          inspectImageLink
          containsItems {
            item {
              id
            }
          }
          buyFor {
            source
            vendor {
              name
              normalizedName
              ... on TraderOffer {
                minTraderLevel
                buyLimit
              }
              ... on FleaMarket {
                foundInRaidRequired
                enabled
              }
            }
            priceRUB
            price
          }
        }
        slots {
          id
          name
          nameId
          required
          filters {
            allowedItems {
              id
            }
          }
        }
        defaultPreset {
          baseImageLink
          gridImageLinkFallback
          gridImageLink
          iconLinkFallback
          iconLink
          image512pxLink
          image8xLink
          imageLink
          imageLinkFallback
          inspectImageLink
        }
      }
    }
  }
}
"""

# Query to fetch all mods with their slots (with language and gameMode support)
MODS_QUERY = """
query AllMods($lang: LanguageCode, $gameMode: GameMode) {
  items(gameMode: $gameMode, lang: $lang, types: mods) {
    id
    basePrice
    avg24hPrice
    buyFor {
      currency
      priceRUB
      source
      vendor {
        name
        normalizedName
        ... on TraderOffer {
          minTraderLevel
          buyLimit
        }
      }
    }
    accuracyModifier
    ergonomicsModifier
    recoilModifier
    name
    normalizedName
    shortName
    weight
    image8xLink
    image512pxLink
    imageLink
    iconLinkFallback
    iconLink
    conflictingSlotIds
    conflictingItems {
      id
    }
    properties {
      ... on ItemPropertiesWeaponMod {
        ergonomics
        recoilModifier
        slots {
          id
          name
          nameId
          required
          filters {
            allowedItems {
              id
            }
          }
        }
      }
      ... on ItemPropertiesBarrel {
        ergonomics
        recoilModifier
        slots {
          id
          name
          nameId
          required
          filters {
            allowedItems {
              id
            }
          }
        }
      }
      ... on ItemPropertiesMagazine {
        ergonomics
        recoilModifier
        capacity
        ammoCheckModifier
        loadModifier
        malfunctionChance
      }
      ... on ItemPropertiesScope {
        ergonomics
        recoilModifier
        sightingRange
        sightModes
        zoomLevels
        slots {
          id
          name
          nameId
          required
          filters {
            allowedItems {
              id
            }
          }
        }
      }
    }
    imageLinkFallback
    inspectImageLink
    baseImageLink
    minLevelForFlea
    bsgCategory {
      id
      name
    }
  }
}
"""