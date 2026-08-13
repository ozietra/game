"""Which generator parts make up every fighter in the game.

Each entry lists catalogue ids in no particular order; the builder sorts the
resulting layers by the z position the LPC project assigns them, so a shield
ends up behind a torso and a helmet in front of a head without special cases.

`attack` picks the animation row used when the fighter swings, shoots or
casts. `body` picks which body type variant of every part gets pulled.
"""

HEROES = {
    "warden": {
        "body": "male",
        "facing": "right",
        "attack": "slash",
        "parts": [
            "body-Body_color_light",
            "head-Human_male_light",
            "legs-Armour_steel",
            "armour-Plate_steel",
            "arms-Armour_steel",
            "shoulders-Plate_steel",
            "shoes-Boots_charcoal",
            "shoes_plate-Boots_Metal_Plating_steel",
            "hat-Greathelm_steel",
            "shield-Heater_Shield_Base_umber",
            "weapon-Longsword_longsword",
        ],
    },
    "ranger": {
        "body": "female",
        "facing": "right",
        "attack": "shoot",
        "parts": [
            "body-Body_color_light",
            "head-Human_female_light",
            "hair-Ponytail_dark_brown",
            "legs-Leggings_leather",
            "clothes-Longsleeve_forest",
            "shoes-Boots_brown",
            "bauldron-Bauldron_leather",
            "quiver-Quiver_quiver",
            "weapon-Normal_dark",
            "ammo-Ammo_arrow",
        ],
    },
    "magus": {
        "body": "female",
        "facing": "right",
        "attack": "cast",
        "parts": [
            "body-Body_color_light",
            "head-Human_female_light",
            "clothes-Robe_blue",
            "shoes-Boots_charcoal",
            "hat-Hood_blue",
            "weapon-Diamond_staff_silver",
        ],
    },
    "preacher": {
        "body": "male",
        "facing": "right",
        "attack": "slash",
        "extra_anims": {"cast": "cast"},
        "parts": [
            "body-Body_color_light",
            "head-Human_male_light",
            "legs-Pants_gray",
            "chainmail-Chainmail_gray",
            "shoes-Boots_brown",
            "hat-Hood_white",
            "cape-Solid_gray",
            "shield-Shield_round_silver",
            "weapon-Mace_mace",
        ],
    },
}

ENEMIES = {
    # cellars
    "rat": {
        "body": "child",
        "facing": "left",
        "attack": "slash",
        "parts": ["body-Body_color_fur_grey", "head-Rat_fur_grey"],
    },
    "goblin": {
        "body": "child",
        "facing": "left",
        "attack": "slash",
        "parts": [
            "body-Body_color_pale_green",
            "head-Goblin_pale_green",
            "legs-Pants_brown",
            "clothes-Shortsleeve_brown",
            "weapon-Dagger_dagger",
        ],
    },
    "cutthroat": {
        "body": "male",
        "facing": "left",
        "attack": "slash",
        "parts": [
            "body-Body_color_light",
            "head-Human_male_gaunt_light",
            "legs-Pants_charcoal",
            "clothes-Longsleeve_charcoal",
            "shoes-Boots_black",
            "hat-Hood_charcoal",
            "weapon-Dagger_dagger",
        ],
    },
    # catacombs
    "skeleton": {
        "body": "male",
        "facing": "left",
        "attack": "slash",
        "parts": [
            "body-Skeleton_skeleton",
            "head-Skeleton_skeleton",
            "weapon-Arming_Sword_iron",
        ],
    },
    "revenant": {
        "body": "male",
        "facing": "left",
        "attack": "slash",
        "parts": [
            "body-Zombie_zombie",
            "head-Human_male_zombie_green",
            "legs-Pants_charcoal",
            "clothes-Longsleeve_brown",
        ],
    },
    "gravewarden": {
        "body": "male",
        "facing": "left",
        "attack": "thrust",
        "parts": [
            "body-Skeleton_skeleton",
            "head-Skeleton_skeleton",
            "armour-Plate_iron",
            "arms-Armour_iron",
            "shoulders-Plate_iron",
            "legs-Armour_iron",
            "hat-Close_helm_iron",
            "weapon-Spear_dark",
        ],
    },
    # warrens
    "orc": {
        "body": "muscular",
        "facing": "left",
        "attack": "slash",
        "parts": [
            "body-Body_color_green",
            "head-Orc_male_green",
            "legs-Pants_brown",
            "bauldron-Bauldron_leather",
            "weapon-Waraxe_waraxe",
        ],
    },
    "boarman": {
        "body": "muscular",
        "facing": "left",
        "attack": "slash",
        "parts": [
            "body-Body_color_fur_brown",
            "head-Boarman_fur_brown",
            "legs-Pants_brown",
            "weapon-Club_club",
        ],
    },
    "wolfman": {
        "body": "muscular",
        "facing": "left",
        "attack": "slash",
        "parts": [
            "body-Body_color_fur_grey",
            "head-Wolf_male_fur_grey",
            "legs-Pants_brown",
        ],
    },
    # crystal seam
    "lizard": {
        "body": "male",
        "facing": "left",
        "attack": "thrust",
        "parts": [
            "body-Body_color_bright_green",
            "head-Lizard_male_bright_green",
            "legs-Pants_forest",
            "weapon-Spear_medium",
        ],
    },
    "troll": {
        "body": "muscular",
        "facing": "left",
        "attack": "slash",
        "parts": [
            "body-Body_color_dark_green",
            "head-Troll_dark_green",
            "legs-Pants_brown",
            "weapon-Club_club",
        ],
    },
    "warlock": {
        "body": "male",
        "facing": "left",
        "attack": "cast",
        "parts": [
            "body-Body_color_pale_green",
            "head-Human_male_gaunt_pale_green",
            "clothes-Robe_purple",
            "hat-Hood_purple",
            "weapon-Gnarled_staff_gold",
        ],
    },
    # the maw
    "minotaur": {
        "body": "muscular",
        "facing": "left",
        "attack": "slash",
        "parts": [
            "body-Body_color_fur_black",
            "head-Minotaur_fur_black",
            "legs-Pants_charcoal",
            "weapon-Waraxe_waraxe",
        ],
    },
    "vampire": {
        "body": "male",
        "facing": "left",
        "attack": "slash",
        "parts": [
            "body-Body_color_lavender",
            "head-Vampire_lavender",
            "legs-Pants_black",
            "clothes-Longsleeve_black",
            "cape-Solid_maroon",
            "shoes-Boots_black",
            "weapon-Rapier_rapier",
        ],
    },
    "bone_knight": {
        "body": "male",
        "facing": "left",
        "attack": "slash",
        "parts": [
            "body-Skeleton_skeleton",
            "head-Skeleton_skeleton",
            "armour-Plate_gold",
            "arms-Armour_gold",
            "shoulders-Plate_gold",
            "legs-Armour_gold",
            "hat-Greathelm_gold",
            "cape-Solid_black",
            "shield-Heater_Shield_Base_coffee",
            "weapon-Longsword_longsword",
        ],
    },
}
