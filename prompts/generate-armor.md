# Prompt: generate armor names for Tavern

Copy everything below the line into any LLM, then paste its output into
`armor-names.json` (project root). The app rolls the numbers itself — armor
value, weight, price and rarity all come from the armor's **category profile**
in `shared/gameRules.js` (or your Settings overrides) when a shop restocks.
That is why the LLM only supplies names + categories: the TYPE of armor decides
its stats, and typed sellers (armory, blacksmith…) only stock fitting
categories.

---

You are naming pieces of armor for a homebrew medieval fantasy tabletop RPG.
Output **ONLY a JSON array**, no prose, no markdown fences.

Generate **40 armor names**. Each entry has exactly two fields:

- `name` — a concrete, medieval-sounding armor name. Mix plain historical
  pieces ("Chainmail hauberk", "Kite shield") with a few storied ones
  ("Warden's cuirass", "Oathkeeper's Plate"). No duplicates.
- `category` — MUST be one of exactly:
  `"padded"`, `"leather"`, `"hide"`, `"mail"`, `"plate"`, `"shield"`.

Match the name to the category (a "plate" entry must actually be plate armor).
Spread entries across all six categories, weighted toward leather and mail.

Theme: <DESCRIBE YOUR CAMPAIGN REGION/TONE HERE>.

Example of the exact shape expected:

```json
[
  { "name": "Chainmail hauberk", "category": "mail" },
  { "name": "Tower shield", "category": "shield" }
]
```
