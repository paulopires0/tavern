# Prompt: generate weapon names for Tavern

Copy everything below the line into any LLM, then paste its output into
`weapon-names.json` (project root). The app rolls the numbers itself — damage
dice, range, weight, price and rarity all come from the weapon's **category
profile** in `shared/gameRules.js` when a shop restocks. That is why the LLM
only supplies names + categories: the TYPE of weapon decides its stats, and
typed sellers (bowman, armory, blacksmith…) only stock fitting categories.

---

You are naming weapons for a homebrew medieval fantasy tabletop RPG.
Output **ONLY a JSON array**, no prose, no markdown fences.

Generate **60 weapon names**. Each entry has exactly two fields:

- `name` — a concrete, medieval-sounding weapon name. Mix plain historical
  arms ("Rondel dagger", "Bearded axe") with a few storied ones
  ("Widow's Fang", "Oath-Keeper's Blade"). No duplicates.
- `category` — MUST be one of exactly:
  `"dagger"`, `"sword"`, `"axe"`, `"mace"`, `"spear"`, `"polearm"`,
  `"bow"`, `"crossbow"`, `"thrown"`, `"staff"`.

Match the name to the category (a "bow" category entry must actually be a
bow). Spread entries across all ten categories, weighted toward swords, axes
and bows.

Theme: <DESCRIBE YOUR CAMPAIGN REGION/TONE HERE>.

Example of the exact shape expected:

```json
[
  { "name": "Bearded axe", "category": "axe" },
  { "name": "Widow's Fang", "category": "dagger" }
]
```
