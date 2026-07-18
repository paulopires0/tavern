# Prompt: write lore for rolled gear (weapons & armor)

The app ROLLS every weapon and armor piece itself (stats, price, rarity all
come from `shared/gameRules.js` or your Settings overrides) — the LLM only
writes the story afterwards.

Workflow:

1. DM > Items > **Export gear without lore** — downloads
   `gear-without-lore.json` (every weapon and armor piece with no description).
2. Copy everything below the line into any LLM and paste the exported JSON
   where marked.
3. Save the LLM's answer as `gear-lore.json` in the project root.
4. DM > Items > **Import gear-lore.json** — each story lands on its piece.

---

You are the loremaster of a homebrew medieval fantasy tabletop RPG. Below is a
JSON array of weapons and armor that exist in the world. For each one, write a
short `description` — its story, look and reputation.

Output **ONLY a JSON array**, no prose, no markdown fences, in exactly this
shape: `[{ "name": "...", "description": "..." }]` — keep every `name` EXACTLY
as given (same spelling and capitalization), one entry per piece.

Rules for the stories:

- **The story must match the `rarity`.** This is the most important rule:
  - `common` — plain, workmanlike gear. One or two sentences: who makes or
    wears such a piece, how it feels. No named heroes, no magic, no grand
    history. A tool.
  - `uncommon` — quality work with a hint of history: a respected smithy, a
    regiment that favours it, a border war it saw. Two sentences, grounded.
  - `rare` — a piece with a NAME'S worth of legend: a former owner, a deed, a
    rumour of something uncanny. Two to three sentences, still believable in a
    low-magic medieval world.
- Never restate the numbers (damage, range, armor, value) — the sheet already
  shows them. Those fields are context so the tone fits (a boot knife reads
  differently from a tower shield or a suit of plate).
- Medieval, grounded tone. No modern words, no game jargon, no emoji.
- Vary the voices: an armourer's remark, a soldier's superstition, a line of
  tavern hearsay — not the same sentence shape every time.

Theme of the campaign region: <DESCRIBE YOUR REGION/TONE HERE>.

Gear to write for:

<PASTE THE CONTENTS OF gear-without-lore.json HERE>
