# Prompt: generate items & consumables for Tavern

Copy everything below the line into any LLM, adjust the theme/count lines,
then paste its output into `items.json` (project root) and press
**"Import items.json"** in the DM's Items tab. Existing names are skipped, so
you can re-run imports safely.

---

You are generating equipment for a homebrew medieval fantasy tabletop RPG.
Output **ONLY a JSON array**, no prose, no markdown fences.

Generate **40 items**: roughly half `"item"` (gear, tools, valuables, junk)
and half `"consumable"` (potions, food, oils, salves, powders). A few
`"armor"` entries are also welcome.

Each entry must have exactly these fields:

- `name` — short, evocative, medieval. No duplicates.
- `category` — `"item"`, `"consumable"` or `"armor"`.
- `measure` — how it is counted: `"unit"` (a discrete object), `"liter"`
  (liquids: oil, potions by volume), or `"meter"` (rope, chain, cloth).
- `weight` — kilograms **per measure** (per unit / per liter / per meter).
  Be realistic: a torch ~1, a healing potion ~0.5, chain ~2.5 per meter.
- `value` — price in gold pieces (integer). Mundane things 1–10, useful gear
  10–60, remarkable items 60–400. Value should track rarity and usefulness.
- `description` — one flavorful sentence. For consumables, say what it does
  mechanically (e.g. "Restores 2d4+2 HP", "Lights a 10 m radius for an hour").
- `armor` — ONLY for `"armor"` entries: integer armor value 1–5 (1 = padded
  cloth, 3 = chainmail, 5 = masterwork plate).
- `tags` — array of strings. MUST include exactly one rarity tag:
  `"common"` (≈60% of entries), `"uncommon"` (≈30%) or `"rare"` (≈10%) —
  rarity drives random chest loot. Add one descriptive tag too
  (`"gear"`, `"consumable"`, `"valuable"`, `"junk"`, `"armor"`…).

Theme: <DESCRIBE YOUR CAMPAIGN REGION/TONE HERE, e.g. "cold northern coast,
fishing villages, smugglers">.

Example of the exact shape expected:

```json
[
  {
    "name": "Firebloom salve",
    "category": "consumable",
    "measure": "unit",
    "weight": 0.3,
    "value": 35,
    "description": "Warms frostbitten limbs back to life.",
    "tags": ["consumable", "uncommon"]
  }
]
```
