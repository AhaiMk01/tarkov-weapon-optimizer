"""
GraphQL queries for the Tarkov.dev API.
"""

# Query to fetch all guns with their slots
GUNS_QUERY = """
query AllGuns {
  itemsByType(type: gun) {
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

# Query to fetch all mods with their slots (for nested attachments)
# Note: Properties vary by mod type, so we query multiple fragment types
MODS_QUERY = """
query AllMods {
  itemsByType(type: mods) {
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

# Query to fetch translations for all items
TRANSLATIONS_QUERY = """
query MyQuery($lang: LanguageCode) {
  items(lang: $lang) {
    id
    name
    shortName
  }
}
"""

# Query to fetch translated category names
CATEGORIES_QUERY = """
query transCategories($lang: LanguageCode) {
  itemCategories(lang: $lang) {
    id
    name
    normalizedName
  }
}
"""
