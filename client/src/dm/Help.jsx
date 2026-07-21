import React from 'react';

// The guide that keeps the rest of the console free of long explanations.
// Terse on purpose — every panel elsewhere links its meaning back to here.
export default function Help() {
  return (
    <div className="panel help">
      <div className="card">
        <h3>The three screens</h3>
        <ul>
          <li><strong>Live</strong> — your table: move tokens, reveal fog, play music, watch the party.</li>
          <li><strong>TV / Party</strong> — the shared screen (Settings → open the link). Shows only what the party can see, fog applied.</li>
          <li><strong>Players</strong> — each person logs in with their character name + password on their phone and edits their own sheet.</li>
        </ul>
      </div>

      <div className="card">
        <h3>Live table</h3>
        <ul>
          <li><strong>Move</strong> a token by dragging it. <strong>Shift-click</strong> several, then drag any of them to move the group.</li>
          <li>Drop a token on a <strong>door</strong> to travel (the whole selection goes together); on a <strong>chest</strong> or <strong>shop</strong> to open it.</li>
          <li>Select one character to show their <strong>weapon-range ring</strong>.</li>
          <li>Walls, curtains and cliffs enforce themselves: the TV walks tokens around walls, or snaps (teleports) when there is no way through.</li>
          <li><strong>Pan</strong> by dragging the background, <strong>zoom</strong> with the wheel. Tokens stay visible at any zoom.</li>
        </ul>
      </div>

      <div className="card">
        <h3>Sight &amp; fog</h3>
        <ul>
          <li>The party remembers where it has been (dimmed) and sees live only what is in view now. Unseen ground is dark.</li>
          <li><strong>Give map</strong> = everyone remembers the whole layout. <strong>Give vision</strong> = everyone sees everything live. <strong>Reset explored fog</strong> forgets it all.</li>
          <li><strong>Visibility</strong> is the light level — it multiplies every character's sight (×1 day, lower = darker night). Slider on Live, default in the map editor.</li>
        </ul>
      </div>

      <div className="card">
        <h3>Map editor</h3>
        <ul>
          <li><strong>Ruler</strong> first: click two points a known distance apart and type the metres, so distances are real.</li>
          <li>Paint physics: <strong>Wall</strong> (blocks move + sight), <strong>Curtain</strong> (sight only), <strong>Cliff</strong> (one-way — arrows show the allowed direction, flip if wrong).</li>
          <li><strong>Brush / Line / Rectangle</strong> drag to paint; <strong>Path</strong> clicks each corner (Enter saves, first dot closes a room, Backspace undo, Esc cancel); <strong>Rubber</strong> erases part of a stroke.</li>
          <li><strong>Door</strong>: pick the destination on the other map first, then click where the door sits. <strong>Chest / Shop / NPC</strong> place objects; <strong>Remove</strong> deletes one.</li>
          <li><strong>Template</strong> saves a reusable house/dungeon; <strong>Duplicate</strong> stamps a copy.</li>
          <li><strong>Kingdom map</strong> shows only where the party is; <strong>Dungeon</strong> maps make the party TV frame just the explored part — both grow (and zoom out) as the party discovers more, and the party never sees the map's true size.</li>
          <li>The kingdom map lives behind its own <strong>Kingdom map</strong> button (Live tab), not the normal list. Travelling between far places uncovers the route automatically; <strong>Simulate travel</strong> lets you draw a journey the party walks and discovers on the TV. The <strong>Reveal size</strong> slider (and each place's Visibility) sets how much the kingdom uncovers.</li>
          <li>In the Live tab the map list shows only maps this one has doors to; <strong>All maps…</strong> opens the whole map as a graph (bigger nodes = more connections) — click a node to jump, or click a <strong>line</strong> to mark that door a <strong>kingdom journey</strong>. Sending the party through a journey door opens a window where you <strong>draw the road</strong> they take across the kingdom; the TV then walks exactly that route (uncovering it) and shows the destination city when they arrive.</li>
          <li>Background images may be JPG/PNG or <strong>SVG</strong> (SVGs stay razor-sharp at any zoom).</li>
          <li><strong>Weather</strong>: save named looks (day/night/snow) — only the image and light change, everything else stays.</li>
        </ul>
      </div>

      <div className="card">
        <h3>Items, shops &amp; chests</h3>
        <ul>
          <li>Categories: item, consumable, weapon, armor, lore, and <strong>campaign</strong> (DM-only — players can't add these).</li>
          <li>Weapons and armor roll their own stats and a rarity (common/uncommon/rare). All the generation numbers are editable in <strong>Settings</strong>.</li>
          <li>Give them stories: <strong>Export gear without lore</strong> → an LLM (<code>prompts/generate-gear-lore.md</code>) → <strong>Import gear-lore.json</strong>.</li>
          <li>Bulk-add plain items from <strong>items.json</strong> using the prompt files in <code>prompts/</code>.</li>
          <li>A shop's <strong>seller type</strong> keeps its random weapon and armor restocks sensible. Players sell at half price.</li>
          <li>In a chest or trade, tick <strong>“show on phone”</strong> to mirror the contents to that player's app; otherwise only you see them.</li>
        </ul>
      </div>

      <div className="card">
        <h3>The rest</h3>
        <ul>
          <li><strong>My notes</strong> (Live): private pins only you see — click to fold, drag the card anywhere.</li>
          <li><strong>Inventory feed</strong>: pickups, drops and trades pop as notifications on the left edge.</li>
          <li><strong>Bestiary</strong>: define a monster once, spawn copies from Live. <strong>Images</strong>: flash a picture on the TV. <strong>Music</strong>: per-map YouTube tracks + a soundboard.</li>
          <li>Any token/art upload lets you <strong>crop</strong> to the part you want.</li>
          <li><strong>Settings</strong>: the TV link, the stat block, DM password, and new-character defaults.</li>
        </ul>
      </div>
    </div>
  );
}
