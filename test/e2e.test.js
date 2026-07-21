// Boots the full server (fresh temp DB) and exercises the real API + sockets
// on the CONTINUOUS map: login, painting walls/cliffs, movement blocked by
// them, doors, fog cells on a live TV socket, reveals, loot, trading, seller
// types, campaign items, music and the soundboard.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-test-'));
process.env.DM_PASSWORD = 'test-dm-pw';

const { createServer } = await import('../server/app.js');
const { getConfig, setConfig } = await import('../server/db.js');
const { io: ioc } = await import('socket.io-client');

const { server } = createServer();
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let dmToken = null;
async function api(method, url, body, token = dmToken) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { 'x-auth-token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

// Sockets buffer every event from creation so nothing is lost between
// 'connect' and the test attaching a listener.
function connectSocket(auth) {
  const socket = ioc(base, { auth, transports: ['websocket'], reconnection: false });
  const queues = new Map();
  const queueOf = (event) => {
    if (!queues.has(event)) queues.set(event, { items: [], waiters: [] });
    return queues.get(event);
  };
  socket.onAny((event, payload) => {
    const q = queueOf(event);
    const waiter = q.waiters.shift();
    if (waiter) waiter(payload); else q.items.push(payload);
  });
  const next = (event) => {
    const q = queueOf(event);
    if (q.items.length) return Promise.resolve(q.items.shift());
    return new Promise((resolve) => q.waiters.push(resolve));
  };
  const latest = async (event) => { // drain to the newest buffered payload
    const q = queueOf(event);
    let out = await next(event);
    while (q.items.length) out = q.items.shift();
    return out;
  };
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve({ socket, next, latest, close: () => socket.close() }));
    socket.once('connect_error', reject);
  });
}

const cleanup = [];
test.after(async () => {
  for (const s of cleanup) s.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

// Shared fixtures. Maps are 1600x1000 at scale 20 px/m -> fog cells 20 px,
// trigger radius 1.2 m = 24 px, default vision 15 m = 300 px.
let mapA, mapB, hero, itemSword, chestId, shopId;

test('e2e', async (t) => {
  await t.test('login and roles', async () => {
    const dm = await api('POST', '/api/login', { name: '', password: 'test-dm-pw' }, null);
    assert.equal(dm.role, 'dm');
    dmToken = dm.token;

    hero = (await api('POST', '/api/dm/characters', { name: 'Hero', password: 'hunter2' })).id;
    // Pin the vision the fog assertions are written for — the DM tunes the
    // gameRules default freely and the suite must not care.
    await api('PATCH', `/api/dm/characters/${hero}`, { vision_radius: 15 });
    const player = await api('POST', '/api/login', { name: 'Hero', password: 'hunter2' }, null);
    assert.equal(player.role, 'player');
    assert.equal((await api('POST', '/api/login', { name: 'Hero', password: 'no' }, null)).status, 401);
    assert.equal((await api('POST', '/api/dm/characters', { name: 'X' }, null)).status, 401);
  });

  await t.test('maps, painted walls and doors', async () => {
    mapA = (await api('POST', '/api/dm/maps', { name: 'Hall' })).id;
    mapB = (await api('POST', '/api/dm/maps', { name: 'Crypt' })).id;

    const wall = await api('POST', '/api/dm/strokes', {
      mapId: mapA, kind: 'wall', tool: 'line', points: [[150, 50], [150, 150]], width: 8,
    });
    assert.equal(wall.ok, true);
    assert.equal((await api('POST', '/api/dm/strokes',
      { mapId: mapA, kind: 'nope', points: [[0, 0]] })).status, 400);

    const door = await api('POST', '/api/dm/connections', {
      mapId: mapA, x: 500, y: 500, targetMapId: mapB, targetX: 100, targetY: 100,
      label: 'Stairs', reverse: true,
    });
    assert.equal(door.ok, true);
  });

  await t.test('movement, walls, fog cells on the TV socket', async () => {
    await assert.rejects(connectSocket({ tvKey: 'nonsense' }), /unauthorized/);
    const tv = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tv);
    assert.equal((await tv.next('state')).role, 'tv');
    await tv.next('state:map'); // initial snapshot

    const moved = await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: mapA, x: 100, y: 100 });
    assert.equal(moved.result, 'moved');
    const push = await tv.latest('state:map');
    assert.equal(push.fogGrid['5,5'], 2, 'own cell observed');
    assert.equal(push.fogGrid['9,5'], 0, 'cell behind the wall is unknown');
    assert.equal(push.fogGrid['40,5'], 0, 'beyond vision radius');
    assert.equal(push.characters.length, 1);

    // straight line crosses the wall, but a route AROUND it exists: the move
    // is a walk along that route (the TV animates the detour)
    const around = await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: mapA, x: 200, y: 100 });
    assert.equal(around.result, 'moved');
    assert.equal(around.teleport, false, 'a detour exists: walk, not teleport');
    let pushT = await tv.latest('state:map');
    const heroTv = pushT.characters[0];
    assert.equal(heroTv.teleport, false);
    assert.ok(heroTv.path.length > 2, `path routes around the wall (${heroTv.path.length} waypoints)`);

    // fully enclose a target: no route -> teleport
    await api('POST', '/api/dm/strokes', {
      mapId: mapA, kind: 'wall', tool: 'rect', points: [[560, 560], [640, 640]], width: 8,
    });
    const boxed = await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: mapA, x: 600, y: 600 });
    assert.equal(boxed.teleport, true, 'no way in: teleport');
    // walk back out is also a teleport (boxed in), then continue outside
    await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: mapA, x: 260, y: 110 });

    // walk far away: old spot darkens to memory
    await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: mapA, x: 100, y: 600 });
    const push2 = await tv.latest('state:map');
    assert.equal(push2.fogGrid['5,5'], 1, 'old spot remembered, not observed');
  });

  await t.test('walking reveals the whole path, not just the arrival point', async () => {
    // hero stands at (100,600); walk him clear across the map
    const res = await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: mapA, x: 1400, y: 600 });
    assert.equal(res.teleport, false, 'a walkable route exists');
    const tv = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tv);
    const push = await tv.latest('state:map');
    // the midpoint of the walk is far outside vision from BOTH endpoints —
    // it is remembered only because the character passed through it
    assert.equal(push.fogGrid['37,30'], 1, 'mid-path corridor remembered');
    assert.equal(push.fogGrid['70,30'], 2, 'arrival observed live');
    // back to where the later fog tests expect him
    await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: mapA, x: 100, y: 600 });
  });

  await t.test('DM annotations: private notes, never sent to the TV', async () => {
    const note = await api('POST', '/api/dm/annotations', { mapId: mapA, x: 300, y: 300, text: 'Trap under the rug' });
    assert.equal(note.ok, true);

    let dmMap = await connectAsDmMap(mapA);
    const mine = dmMap.annotations.find((a) => a.id === note.id);
    assert.equal(mine.text, 'Trap under the rug');
    assert.equal(mine.open, 1, 'notes start open');

    const tv = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tv);
    const push = await tv.latest('state:map');
    assert.ok(!('annotations' in push), 'the TV payload carries no annotations');

    await api('PATCH', `/api/dm/annotations/${note.id}`,
      { open: 0, text: 'Trap DISARMED', box_dx: -180, box_dy: 40 });
    dmMap = await connectAsDmMap(mapA);
    const folded = dmMap.annotations.find((a) => a.id === note.id);
    assert.equal(folded.open, 0);
    assert.equal(folded.text, 'Trap DISARMED');
    assert.equal(folded.box_dx, -180, 'dragged card position persists');
    assert.equal(folded.box_dy, 40);

    await api('DELETE', `/api/dm/annotations/${note.id}`);
    dmMap = await connectAsDmMap(mapA);
    assert.equal(dmMap.annotations.length, 0);
  });

  await t.test('DM ink: drawn on the map, seen by everyone, erased in parts', async () => {
    const tv = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tv);
    await tv.next('state:map');

    const stroke = await api('POST', '/api/dm/ink', {
      mapId: mapA, tool: 'brush', color: '#d34b3f', width: 12,
      points: [[100, 100], [400, 100]],
    });
    assert.equal(stroke.ok, true);

    // unlike private notes, ink DOES reach the party screen
    let push = await tv.latest('state:map');
    assert.equal(push.ink.length, 1, 'the TV sees the DM ink');
    assert.equal(push.ink[0].color, '#d34b3f');
    assert.deepEqual(push.ink[0].points, [[100, 100], [400, 100]]);
    assert.ok(!('ink' in push) || Array.isArray(push.ink));

    // rub the middle out: one line becomes two
    await api('POST', `/api/dm/maps/${mapA}/ink-erase`, { points: [[250, 100]], radius: 30 });
    push = await tv.latest('state:map');
    assert.equal(push.ink.length, 2, 'erasing the middle splits the stroke');

    // undo takes back the most recent stroke (one of the two halves)
    await api('POST', `/api/dm/maps/${mapA}/ink-undo`);
    push = await tv.latest('state:map');
    assert.equal(push.ink.length, 1, 'undo removes the newest stroke');

    // ink is decoration: it never blocks sight (hero still sees his own cell)
    assert.equal(push.fogGrid['5,30'], 2, 'ink does not touch the fog');

    await api('DELETE', `/api/dm/maps/${mapA}/ink`);
    push = await tv.latest('state:map');
    assert.equal(push.ink.length, 0, 'clear wipes the map');
  });

  await t.test('chests never appear on the party screen', async () => {
    // put a chest right where the hero stands (100,600) and give the party full
    // vision, so under any old "show discovered/visible chests" rule it WOULD
    // be sent — the TV payload must still omit it.
    await api('POST', '/api/dm/chests', { mapId: mapA, x: 100, y: 600 });
    await api('POST', `/api/dm/maps/${mapA}/reveal`, { vision: true });
    const tv = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tv);
    const push = await tv.latest('state:map');
    assert.ok(!(push.chests || []).length, 'no chest icons betray loot on the TV');
    await api('POST', `/api/dm/maps/${mapA}/reveal`, { vision: false }); // restore for later tests
  });

  await t.test('reset-fog wipes the party memory of a map', async () => {
    const tv = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tv);
    await tv.next('state:map');
    await api('POST', `/api/dm/maps/${mapA}/reset-fog`);
    const push = await tv.latest('state:map');
    assert.equal(push.fogGrid['5,5'], 0, 'previously seen cell forgotten');
    // hero still stands at (100,600): the live circle re-fills instantly
    assert.equal(push.fogGrid['5,30'], 2, 'live vision unaffected');
  });

  await t.test('reveal map / reveal vision are party-wide and reversible', async () => {
    const tv = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tv);
    await tv.next('state:map');

    await api('POST', `/api/dm/maps/${mapA}/reveal`, { map: true });
    let push = await tv.latest('state:map');
    assert.ok(Object.values(push.fogGrid).every((s) => s >= 1), 'whole layout remembered');
    assert.equal(push.fogGrid['5,30'], 2, 'live vision still live (hero stands at 100,600)');

    await api('POST', `/api/dm/maps/${mapA}/reveal`, { map: false, vision: true });
    push = await tv.latest('state:map');
    assert.ok(Object.values(push.fogGrid).every((s) => s === 2), 'full live vision');

    await api('POST', `/api/dm/maps/${mapA}/reveal`, { vision: false });
    push = await tv.latest('state:map');
    assert.equal(push.fogGrid['40,40'], 0, 'back to what was actually observed');
    assert.equal(push.fogGrid['5,30'], 2, 'live vision kept');
  });

  await t.test('weather is global & coherent: variant swaps look+light, else normal', async () => {
    const tv = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tv);
    let push = await tv.latest('state:map');
    assert.equal(push.fogGrid['12,30'], 2, 'a far cell is observed in daylight (normal weather)');
    const baseImage = (await connectAsDmMap(mapA)).map.image;

    // variant names must be a known weather
    assert.equal((await api('POST', `/api/dm/maps/${mapA}/variants`, { name: 'foggy' })).status, 400, 'unknown weather rejected');
    const night = await api('POST', `/api/dm/maps/${mapA}/variants`,
      { name: 'Night', image: '/uploads/maps/night.png', visibility: 0.05 });
    assert.equal(night.ok, true);

    // night falls campaign-wide
    assert.equal((await api('POST', '/api/dm/weather', { weather: 'night' })).ok, true);
    let dmMap = await connectAsDmMap(mapA);
    assert.equal(dmMap.map.image, '/uploads/maps/night.png', 'night swaps mapA art');
    assert.equal(dmMap.map.visibility, 0.05, '…and dims the light');
    assert.ok(dmMap.strokes.length > 0, 'painted physics survive the weather');
    push = await tv.latest('state:map');
    assert.equal(push.fogGrid['12,30'], 1, 'night shrinks vision: the far cell is only remembered');
    assert.equal(push.fogGrid['5,30'], 2, 'the party still sees its own spot');

    // mapB has NO night variant → it stays on its normal look (coherent fallback)
    assert.equal((await connectAsDmMap(mapB)).map.visibility, 1, 'a map without a night variant keeps normal');

    // back to normal restores mapA's base look
    await api('POST', '/api/dm/weather', { weather: 'normal' });
    dmMap = await connectAsDmMap(mapA);
    assert.equal(dmMap.map.image, baseImage, 'normal restores the base image');
    assert.equal(dmMap.map.visibility, 1, 'and full light');
    push = await tv.latest('state:map');
    assert.equal(push.fogGrid['12,30'], 2, 'daylight again');

    await api('DELETE', `/api/dm/map-variants/${night.id}`);
  });

  await t.test('doors teleport characters and monsters; cliffs are one-way', async () => {
    // drop next to the door (within 24 px trigger radius)
    const res = await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: mapA, x: 510, y: 505 });
    assert.equal(res.result, 'travelled');
    assert.equal(res.mapId, mapB);
    assert.deepEqual([res.x, res.y], [100, 100]);

    const mon = (await api('POST', '/api/dm/monsters', { name: 'Rat', hp: 5, map_id: mapA, x: 400, y: 400 })).id;
    const mres = await api('POST', '/api/dm/move-token', { kind: 'monster', id: mon, mapId: mapA, x: 495, y: 498 });
    assert.equal(mres.result, 'travelled', 'monsters use doors too');

    // full-width cliff on mapB: arrows point up (upward crossing allowed);
    // spanning the whole map so pathfinding cannot walk around it
    await api('POST', '/api/dm/strokes', {
      mapId: mapB, kind: 'cliff', tool: 'line', points: [[0, 400], [1600, 400]], width: 8,
    });
    await api('POST', '/api/dm/move-token', { kind: 'monster', id: mon, mapId: mapB, x: 400, y: 450 });
    const up = await api('POST', '/api/dm/move-token', { kind: 'monster', id: mon, mapId: mapB, x: 400, y: 350 });
    assert.equal(up.teleport, false, 'crossing with the arrows walks normally');
    const down = await api('POST', '/api/dm/move-token', { kind: 'monster', id: mon, mapId: mapB, x: 400, y: 450 });
    assert.equal(down.teleport, true, 'climbing against the cliff = teleport');

    // flip the cliff -> directions swap (monster currently below, y=450)
    const strokes = (await connectAsDmMap(mapB)).strokes;
    const cliff = strokes.find((s) => s.kind === 'cliff');
    await api('PATCH', `/api/dm/strokes/${cliff.id}`, { flipped: 1 });
    const upNow = await api('POST', '/api/dm/move-token', { kind: 'monster', id: mon, mapId: mapB, x: 400, y: 350 });
    assert.equal(upNow.teleport, true, 'the previously-free direction is now the climb');
    const downNow = await api('POST', '/api/dm/move-token', { kind: 'monster', id: mon, mapId: mapB, x: 400, y: 450 });
    assert.equal(downNow.teleport, false, 'flipped cliff walks the other way');
  });

  await t.test('group move applies one delta; dropped on a door the whole group travels', async () => {
    const other = (await api('POST', '/api/dm/characters', { name: 'Ally', password: 'p' })).id;
    await api('POST', '/api/dm/move-token', { kind: 'character', id: other, mapId: mapB, x: 200, y: 600 });
    const res = await api('POST', '/api/dm/move-tokens', {
      moves: [
        { kind: 'character', id: hero, mapId: mapB, x: 220, y: 220 },
        { kind: 'character', id: other, mapId: mapB, x: 220, y: 620 },
      ],
    });
    assert.equal(res.ok, true);
    assert.equal(res.blocked.length, 0);
    let dmMap = await connectAsDmMap(mapB);
    const posOf = (id) => dmMap.characters.find((c) => c.id === id);
    assert.deepEqual([posOf(hero).x, posOf(hero).y], [220, 220]);
    assert.deepEqual([posOf(other).x, posOf(other).y], [220, 620]);

    // drop the whole group onto the reverse door at mapB (100,100): all travel
    // to mapA TOGETHER — landing huddled around the arrival point (500,500)
    const travel = await api('POST', '/api/dm/move-tokens', {
      anchor: { mapId: mapB, x: 102, y: 98 },
      moves: [
        { kind: 'character', id: hero, mapId: mapB, x: 102, y: 98 },
        { kind: 'character', id: other, mapId: mapB, x: 130, y: 120 },
      ],
    });
    assert.equal(travel.travelled, true);
    assert.equal(travel.mapId, mapA);
    dmMap = await connectAsDmMap(mapA);
    const arrivedHero = dmMap.characters.find((c) => c.id === hero);
    const arrivedOther = dmMap.characters.find((c) => c.id === other);
    assert.ok(arrivedHero && arrivedOther, 'both crossed the door');
    for (const c of [arrivedHero, arrivedOther]) {
      assert.ok(Math.hypot(c.x - 500, c.y - 500) < 30,
        `lands in a tight knot at the arrival point (${Math.round(c.x)},${Math.round(c.y)})`);
    }
    // send them back for the later subtests
    await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: mapB, x: 220, y: 220 });
  });

  await t.test('eraser removes only the rubbed part of a stroke', async () => {
    const wall = await api('POST', '/api/dm/strokes', {
      mapId: mapB, kind: 'wall', tool: 'line', points: [[600, 100], [800, 100]], width: 8,
    });
    assert.equal(wall.ok, true);
    // rub the middle out
    const erase = await api('POST', `/api/dm/maps/${mapB}/erase`, { points: [[700, 100]], radius: 20 });
    assert.equal(erase.ok, true);
    const dmMap = await connectAsDmMap(mapB);
    const pieces = dmMap.strokes.filter((s) => s.kind === 'wall' &&
      s.points.every(([x, y]) => y > 90 && y < 110 && x >= 590 && x <= 810));
    assert.ok(pieces.length >= 2, `stroke split into ${pieces.length} pieces`);
    const xs = pieces.flatMap((s) => s.points.map(([x]) => x));
    assert.ok(!xs.some((x) => x > 680 && x < 720), 'the rubbed middle is gone');
    for (const s2 of pieces) await api('DELETE', `/api/dm/strokes/${s2.id}`);
  });

  await t.test('Path tool: a closed multi-corner wall blocks on every segment', async () => {
    // a closed square drawn as ONE polyline (5 points, last == first) — the
    // Path tool stores exactly this shape as a tool:"line" stroke
    const box = [[1000, 600], [1200, 600], [1200, 800], [1000, 800], [1000, 600]];
    const res = await api('POST', '/api/dm/strokes', { mapId: mapB, kind: 'wall', tool: 'line', points: box, width: 10 });
    assert.equal(res.ok, true);
    const dmMap = await connectAsDmMap(mapB);
    const wall = dmMap.strokes.find((s) => s.id === res.id);
    assert.equal(wall.tool, 'line');
    assert.equal(wall.points.length, 5, 'every corner stored');
    // both points below the mapB cliff (y=400) so only THIS wall is in play;
    // the square fully encloses (1100,700), so there is no walkable way in
    const mon = (await api('POST', '/api/dm/monsters', { name: 'Boxed', hp: 5, map_id: mapB, x: 300, y: 700 })).id;
    const inside = await api('POST', '/api/dm/move-token', { kind: 'monster', id: mon, mapId: mapB, x: 1100, y: 700 });
    assert.equal(inside.teleport, true, 'closed polyline wall blocks every segment: no route, teleport');
    await api('DELETE', `/api/dm/monsters/${mon}`);
    await api('DELETE', `/api/dm/strokes/${res.id}`);
  });

  await t.test('bestiary: define once, spawn instances', async () => {
    const tpl = await api('POST', '/api/dm/monster-templates', {
      name: 'Cave troll', hp: 40, stats: { str: 19 }, token_scale: 2, notes: 'Slow, hits hard.',
    });
    assert.equal(tpl.ok, true);
    const spawned = await api('POST', '/api/dm/monsters', {
      templateId: tpl.id, map_id: mapB, x: 500, y: 500,
    });
    assert.equal(spawned.ok, true);
    const dmMap = await connectAsDmMap(mapB);
    const troll = dmMap.monsters.find((m) => m.name === 'Cave troll');
    assert.equal(troll.hp, 40);
    assert.equal(troll.token_scale, 2);
    assert.equal(troll.stats.str, 19);
    await api('DELETE', `/api/dm/monsters/${troll.id}`);
  });

  await t.test('NPCs move on the live map and show on the TV when observed', async () => {
    const npc = (await api('POST', '/api/dm/npcs', { name: 'Old Tom', map_id: mapB, x: 600, y: 600 })).id;
    const mv = await api('POST', '/api/dm/move-token', { kind: 'npc', id: npc, mapId: mapB, x: 640, y: 620 });
    assert.equal(mv.result, 'moved');
    const dmMap = await connectAsDmMap(mapB);
    const tom = dmMap.npcs.find((n) => n.id === npc);
    assert.deepEqual([tom.x, tom.y], [640, 620]);

    // the party sees NPCs only where it currently sees the ground (hero
    // stands at 220,220 — the NPC at 640,620 is in the dark)
    await api('POST', `/api/dm/maps/${mapB}/set-active`);
    const tv = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tv);
    // park the NPC in a far corner nobody can see (robust to vision tuning)
    await api('POST', '/api/dm/move-token', { kind: 'npc', id: npc, mapId: mapB, x: 1550, y: 950 });
    let push = await tv.latest('state:map');
    assert.ok(!(push.npcs || []).some((x) => x.id === npc), 'NPC in the dark stays off the TV');
    await api('POST', '/api/dm/move-token', { kind: 'npc', id: npc, mapId: mapB, x: 250, y: 250 });
    push = await tv.latest('state:map');
    const seenTom = (push.npcs || []).find((x) => x.id === npc);
    assert.ok(seenTom, 'NPC next to the party appears on the TV');
    assert.equal(seenTom.name, 'Old Tom');

    await api('POST', '/api/dm/unplace', { kind: 'npc', id: npc });
    const after = await connectAsDmMap(mapB);
    assert.ok(!after.npcs.some((n) => n.id === npc), 'unplaced NPC left the map');
    await api('DELETE', `/api/dm/npcs/${npc}`);
  });

  await t.test('chest trigger, generate (no lore/campaign), loot', async () => {
    itemSword = (await api('POST', '/api/dm/items', { name: 'Sword', category: 'weapon', weight: 3, value: 10, damage: '1d6', range: 1, tags: ['weapon', 'common'] })).id;
    await api('POST', '/api/dm/items', { name: 'Old letter', category: 'lore', lore_text: 'secrets', tags: [] });
    await api('POST', '/api/dm/items', { name: 'Kings seal', category: 'campaign', lore_text: 'DM only', tags: [] });

    chestId = (await api('POST', '/api/dm/chests', { mapId: mapB, x: 700, y: 700 })).id;
    await api('POST', `/api/dm/chests/${chestId}/generate`, { count: 6 });
    const contents = await api('GET', `/api/dm/chests/${chestId}`);
    assert.equal(contents.entries.reduce((s, e) => s + e.quantity, 0), 6);
    assert.ok(contents.entries.every((e) => !['lore', 'campaign'].includes(e.category)),
      'rolled loot never contains lore/campaign items');

    const onChest = await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: mapB, x: 705, y: 694 });
    assert.equal(onChest.result, 'chest');
    assert.equal(onChest.chestId, chestId);

    // hide it from players: it vanishes from the TV even though it's discovered
    await api('PATCH', `/api/dm/chests/${chestId}`, { hidden: true });
    const tvB = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tvB);
    await api('POST', `/api/dm/maps/${mapB}/set-active`);
    const push = await tvB.latest('state:map');
    assert.ok(!(push.chests || []).some((c2) => c2.id === chestId), 'hidden chest not on TV');
    await api('PATCH', `/api/dm/chests/${chestId}`, { hidden: false });

    await api('POST', '/api/dm/inventory/transfer', {
      entryId: contents.entries[0].entry_id, toType: 'character', toId: hero, quantity: 1,
    });
  });

  await t.test('typed sellers: shop trigger, trade payouts, coherent restocks', async () => {
    shopId = (await api('POST', '/api/dm/shops', { name: 'Fletcher', category: 'bowman', map_id: mapB, x: 900, y: 300 })).id;
    await api('POST', '/api/dm/inventory/add', { ownerType: 'shop', ownerId: shopId, itemId: itemSword, quantity: 1 });

    const onShop = await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: mapB, x: 905, y: 306 });
    assert.equal(onShop.result, 'shop');
    assert.deepEqual(getConfig('shop_session'), { shopId, characterId: hero, shared: false });

    await api('PATCH', `/api/dm/characters/${hero}`, { gold: 100 });
    let shop = await api('GET', `/api/dm/shops/${shopId}`);
    const swordEntry = shop.entries.find((e) => e.id === itemSword);
    assert.equal(swordEntry.price, 10);
    await api('POST', '/api/dm/trade', { shopId, characterId: hero, entryId: swordEntry.entry_id, quantity: 1, direction: 'buy' });

    const dmSock = await connectSocket({ token: dmToken });
    cleanup.push(dmSock);
    const st = await dmSock.next('state');
    const heroEntry = st.characters.find((c) => c.id === hero).inventory.find((e) => e.id === itemSword);
    const sell = await api('POST', '/api/dm/trade', { shopId, characterId: hero, entryId: heroEntry.entry_id, quantity: 1, direction: 'sell' });
    assert.equal(sell.payout, 5, 'players get 50% of list, shown before selling');

    shop = await api('GET', `/api/dm/shops/${shopId}`);
    assert.equal(shop.entries.find((e) => e.id === itemSword).price, 10, 'no price bump');

    const restock = await api('POST', `/api/dm/shops/${shopId}/restock-weapons`, { count: 4 });
    assert.equal(restock.ok, true);
    shop = await api('GET', `/api/dm/shops/${shopId}`);
    const rolled = shop.entries.filter((e) => e.category === 'weapon' && e.id !== itemSword);
    assert.ok(rolled.length >= 4);
    assert.ok(rolled.every((e) => e.tags.some((tag) => ['bow', 'crossbow', 'thrown'].includes(tag))),
      'a bowman only stocks ranged weapons');
    assert.ok(rolled.every((e) => e.tags.some((tag) => ['common', 'uncommon', 'rare'].includes(tag))),
      'every rolled weapon is labeled with a rarity');
    assert.ok(rolled.every((e) => e.description === '' && !/rank/i.test(e.description)),
      'descriptions stay empty for the lore pass — no rank text');

    const potions = (await api('POST', '/api/dm/shops', { name: 'Herbs', category: 'potions' })).id;
    const nope = await api('POST', `/api/dm/shops/${potions}/restock-weapons`, { count: 2 });
    assert.equal(nope.status, 400, 'potion sellers do not deal in weapons');
  });

  await t.test('armor restock: rolled armor matches the seller type', async () => {
    // shopId is a bowman → light armor only (padded/leather)
    const res = await api('POST', `/api/dm/shops/${shopId}/restock-armor`, { count: 4 });
    assert.equal(res.ok, true);
    assert.ok(res.added.length >= 4 && res.added.every((a) => a.armor >= 1 && a.value >= 1));
    const shop = await api('GET', `/api/dm/shops/${shopId}`);
    const armor = shop.entries.filter((e) => e.category === 'armor');
    assert.ok(armor.length >= 4);
    assert.ok(armor.every((e) => e.tags.some((t) => ['padded', 'leather'].includes(t))), 'a bowman only stocks light armor');
    assert.ok(armor.every((e) => e.tags.some((t) => ['common', 'uncommon', 'rare'].includes(t))), 'rarity tagged');
    assert.ok(armor.every((e) => e.armor >= 1 && e.description === ''), 'has an armor value, empty description for the lore pass');

    const potions = (await api('POST', '/api/dm/shops', { name: 'Herbs armor', category: 'potions' })).id;
    assert.equal((await api('POST', `/api/dm/shops/${potions}/restock-armor`, { count: 2 })).status, 400,
      'potion sellers deal in no armor');
  });

  await t.test('generation params: configurable weapon rules, validated, resettable', async () => {
    const custom = {
      bonusMax: 0, rangeCoef: 0, valueFactor: 1, rareAt: 0.75, uncommonAt: 0.45,
      profiles: { club: { range: [1, 1], dice: [[1, 6]], weight: [2, 2] } },
    };
    assert.equal((await api('POST', '/api/dm/config', { weaponGen: custom })).ok, true);
    let st = await (await pushedDm()).next('state');
    assert.equal(st.weaponGen.bonusMax, 0);
    assert.ok(st.weaponGen.profiles.club, 'the custom profile surfaced to the DM');

    // malformed profiles are rejected, not stored
    const badRes = await api('POST', '/api/dm/config',
      { weaponGen: { profiles: { club: { dice: 'nope', range: [1, 1], weight: [1, 1] } } } });
    assert.equal(badRes.status, 400);

    await api('POST', '/api/dm/config', { weaponGen: null }); // back to defaults
    st = await (await pushedDm()).next('state');
    assert.equal(st.weaponGen.bonusMax, 3, 'cleared back to the built-in default');
  });

  await t.test('a finished journey cue is never handed out again', async () => {
    // a cue left in config from a trip that already ended (arrival timer lost to
    // a restart, or the manual simulate-travel) must not reach ANY client —
    // otherwise re-showing the kingdom map replays the walk, every single time
    setConfig('world_travel', { path: [[0, 0], [200, 200]], nonce: Date.now() - 60000, durationMs: 3000 });
    const tv = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tv);
    assert.equal((await tv.next('state')).worldTravel, null, 'the TV gets no stale cue');
    assert.equal((await (await pushedDm()).next('state')).worldTravel, null, 'nor does the DM');

    // …while a cue that is still running is delivered normally
    setConfig('world_travel', { path: [[0, 0], [200, 200]], nonce: Date.now(), durationMs: 5000 });
    assert.ok((await (await pushedDm()).next('state')).worldTravel?.nonce, 'a running journey still plays');
    setConfig('world_travel', null);
  });

  await t.test('several TVs share one link', async () => {
    const key = getConfig('spectator_key');
    const tv1 = await connectSocket({ tvKey: key });
    const tv2 = await connectSocket({ tvKey: key });
    cleanup.push(tv1, tv2);
    assert.equal((await tv1.next('state')).role, 'tv');
    assert.equal((await tv2.next('state')).role, 'tv');
    assert.ok((await tv1.next('state:map')).map, 'first TV gets the active map');
    assert.ok((await tv2.next('state:map')).map, 'second TV gets it too');
  });

  await t.test('shops appear on the TV once their spot is seen; doors never do', async () => {
    // the fletcher at (900,300) on mapB sits where the hero has walked
    await api('POST', `/api/dm/maps/${mapB}/set-active`);
    const tv = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tv);
    const push = await tv.latest('state:map');
    assert.ok((push.shops || []).some((s2) => s2.id === shopId), 'seen shop is on the TV');
    // mapB has a door the hero walked right past — still not marked
    assert.equal((push.connections || []).length, 0, 'doors are DM knowledge only');
  });

  await t.test('shop/chest contents reach the phone only when the DM shares them', async () => {
    const login = await api('POST', '/api/login', { name: 'Hero', password: 'hunter2' }, null);
    const ps = await connectSocket({ token: login.token });
    cleanup.push(ps);
    let st = await ps.latest('state');
    // walking onto the shop earlier opened a session — but it is not shared
    assert.equal(st.shop, null, 'unshared shop stays off the phone');
    assert.equal(st.chest, null);

    await api('POST', '/api/dm/shop-session', { shopId, characterId: hero, shared: true });
    st = await ps.latest('state');
    assert.equal(st.shop.id, shopId, 'shared shop stock mirrors to the phone');
    assert.ok(st.shop.entries.length >= 1);
    await api('DELETE', '/api/dm/shop-session');
    st = await ps.latest('state');
    assert.equal(st.shop, null, 'hidden again when the session ends');

    await api('POST', '/api/dm/chest-session', { chestId, characterId: hero });
    st = await ps.latest('state');
    assert.equal(st.chest.id, chestId, 'shared chest contents mirror to the phone');
    assert.ok(Array.isArray(st.chest.entries));
    await api('DELETE', '/api/dm/chest-session');
    st = await ps.latest('state');
    assert.equal(st.chest, null);
  });

  await t.test('players: self-edit incl. token size; campaign items refused', async () => {
    const login = await api('POST', '/api/login', { name: 'Hero', password: 'hunter2' }, null);
    const p = (method, url, body) => api(method, url, body, login.token);

    assert.equal((await p('PATCH', '/api/player/me', { hp: 7, armor: 2, token_scale: 1.8 })).ok, true);
    const power = await p('POST', '/api/player/powers', { name: 'Second wind', description: 'Once per day.', circle: 2 });
    assert.equal(power.ok, true);
    await p('POST', '/api/player/diary', { title: 'Day 1', body: 'Found a crypt.' });

    const campaignItem = (await api('POST', '/api/dm/items', { name: 'Wolf seal', category: 'campaign' })).id;
    const refused = await p('POST', '/api/player/inventory/add', { itemId: campaignItem, quantity: 1 });
    assert.equal(refused.status, 400);
    assert.match(refused.error, /DM/);

    const ps = await connectSocket({ token: login.token });
    cleanup.push(ps);
    const st = await ps.next('state');
    assert.equal(st.character.hp, 7);
    assert.equal(st.character.token_scale, 1.8);
    assert.ok(st.character.powers.some((pw) => pw.name === 'Second wind' && pw.circle === 2), 'powers carry a circle');
    assert.ok(st.diary.some((d) => d.title === 'Day 1'));
  });

  await t.test('players add only items/consumables; custom items; feed logs it all', async () => {
    const login = await api('POST', '/api/login', { name: 'Hero', password: 'hunter2' }, null);
    const p = (url, body) => api('POST', url, body, login.token);

    // weapons are refused for players (only the DM hands those out)
    assert.equal((await p('/api/player/inventory/add', { itemId: itemSword, quantity: 1 })).status, 400,
      'a player cannot add a weapon');

    // a plain consumable from the catalog is fine, and it hits the DM feed
    const torch = (await api('POST', '/api/dm/items', { name: 'Torch', category: 'consumable' })).id;
    await p('/api/player/inventory/add', { itemId: torch, quantity: 2 });
    const dm = await connectSocket({ token: dmToken });
    cleanup.push(dm);
    let st = await dm.latest('state');
    assert.deepEqual(
      [st.activity[0].characterName, st.activity[0].itemName, st.activity[0].delta, st.activity[0].reason],
      ['Hero', 'Torch', 2, 'added'], 'the pickup is on the feed');

    // a custom item the player invents lands in their bag and on the feed
    assert.equal((await p('/api/player/inventory/custom', { name: 'Lucky pebble', category: 'item', weight: 0.1 })).ok, true);
    st = await dm.latest('state');
    assert.equal(st.activity[0].itemName, 'Lucky pebble');
    assert.equal(st.activity[0].reason, 'added');
    const ps = await connectSocket({ token: login.token });
    cleanup.push(ps);
    const pst = await ps.next('state');
    assert.ok(pst.character.inventory.some((e) => e.name === 'Lucky pebble'), 'the custom item is in the bag');
    // …and it's tagged 'custom' so the phone's pick-list can hide it
    const custom = pst.items.find((i) => i.name === 'Lucky pebble');
    assert.ok(custom && custom.tags.includes('custom'), 'custom items are tagged for the picker to hide');

    // a player may craft a CUSTOM weapon (the catalog picker can't add weapons)
    assert.equal((await p('/api/player/inventory/custom',
      { name: 'Whittled spear', category: 'weapon', damage: '1d6', range: 2, weight: 2 })).ok, true);
    const pst2 = await (await (async () => { const s = await connectSocket({ token: login.token }); cleanup.push(s); return s; })()).next('state');
    const spear = pst2.character.inventory.find((e) => e.name === 'Whittled spear');
    assert.ok(spear && spear.category === 'weapon' && spear.damage === '1d6', 'custom weapon has its stats');

    // dropping logs a negative delta
    const entry = pst.character.inventory.find((e) => e.id === torch);
    await p('/api/player/inventory/remove', { entryId: entry.entry_id, quantity: 1 });
    st = await dm.latest('state');
    assert.equal(st.activity[0].delta, -1, 'a drop is a negative delta');
    assert.equal(st.activity[0].reason, 'dropped');
  });

  await t.test('kingdom map: derived tokens, permanent reveal, no moves', async () => {
    const world = (await api('POST', '/api/dm/maps', { name: 'Kingdom' })).id;
    // kingdoms have tiny px-per-meter scales; the fog lattice caps its density
    await api('PATCH', `/api/dm/maps/${world}`, { is_world: 1, scale: 1 });
    await api('PATCH', `/api/dm/maps/${mapB}`, { world_x: 800, world_y: 500 });

    // hero is on mapB: re-entering it stamps the reveal + the derived marker
    await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: mapB, x: 240, y: 240 });
    await api('POST', `/api/dm/maps/${world}/set-active`);

    const tv = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tv);
    const push = await tv.latest('state:map');
    assert.equal(push.map.is_world, 1);
    const heroMark = push.characters.find((c) => c.id === hero);
    assert.ok(heroMark, 'hero appears on the world map');
    assert.ok(Math.hypot(heroMark.x - 800, heroMark.y - 500) < 60, 'at his map marker');
    assert.equal(push.monsters.length, 0, 'players see only themselves');
    assert.equal((push.connections || []).length, 0);
    // reveal circle around the marker (cell 50,31 at capped cell_px 16)
    assert.equal(push.fogGrid['50,31'], 2, 'visited marker uncovered, fully visible');
    assert.equal(push.fogGrid['1,1'], 0, 'unvisited kingdom stays dark');

    const refused = await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: world, x: 100, y: 100 });
    assert.equal(refused.status, 400, 'tokens cannot be placed on the world map');

    // the DM's kingdom view also shows just the party — no map-location markers
    const dmWorld = await connectAsDmMap(world);
    assert.ok(!('worldMarkers' in dmWorld), 'no map markers on the kingdom map');
    assert.ok(dmWorld.characters.some((c) => c.id === hero));
    await api('POST', `/api/dm/maps/${mapB}/set-active`);
  });

  await t.test('dungeon flag rides to the TV; the door graph is exposed', async () => {
    await api('PATCH', `/api/dm/maps/${mapB}`, { is_dungeon: 1 });
    const st = await (await pushedDm()).next('state');
    assert.equal(st.maps.find((m) => m.id === mapB).is_dungeon, 1, 'dungeon flag persists');
    // the mapA <-> mapB door pair is in the link graph the picker uses
    assert.ok((st.mapLinks || []).some((l) =>
      (l.map_id === mapA && l.target_map_id === mapB) || (l.map_id === mapB && l.target_map_id === mapA)),
    'the door link is in the graph');

    await api('POST', `/api/dm/maps/${mapB}/set-active`);
    const tv = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tv);
    assert.equal((await tv.latest('state:map')).map.is_dungeon, 1, 'the TV map carries the dungeon flag (it frames the explored area)');
    await api('PATCH', `/api/dm/maps/${mapB}`, { is_dungeon: 0 });
  });

  await t.test('kingdom: travel reveals the corridor; simulate-travel walks + reveals a path', async () => {
    const world = (await (await pushedDm()).next('state')).maps.find((m) => m.is_world);
    assert.ok(world, 'a kingdom map exists (scale 1, world cell_px 16)');
    // give mapA a far world location, then travel hero mapB(800,500) -> mapA(200,500)
    await api('PATCH', `/api/dm/maps/${mapA}`, { world_x: 200, world_y: 500 });
    await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: mapB, x: 240, y: 240 });
    await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: mapA, x: 240, y: 240 });
    await api('POST', `/api/dm/maps/${world.id}/set-active`);
    const tv = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tv);
    let push = await tv.latest('state:map');
    assert.equal(push.fogGrid['31,31'], 2, 'the route between the two towns is uncovered (midpoint)');

    // simulate-travel: draw a route up the map; it reveals + cues the TV walk
    await api('POST', '/api/dm/world-travel', { path: [[200, 500], [200, 100]] });
    const g = await tv.latest('state');
    assert.ok(g.worldTravel?.nonce, 'the TV receives the travel cue');
    assert.deepEqual(g.worldTravel.path[0], [200, 500]);
    push = await tv.latest('state:map');
    assert.equal(push.fogGrid['12,18'], 2, 'the drawn route is now revealed (≈200,296)');

    // kingdom visibility scales the reveal radius (60 → 180 px at ×3)
    assert.notEqual(push.fogGrid['59,31'], 2, 'far cell dark at ×1');
    await api('PATCH', `/api/dm/maps/${world.id}`, { visibility: 3 });
    await api('POST', '/api/dm/world-travel', { path: [[800, 500]] });
    push = await tv.latest('state:map');
    assert.equal(push.fogGrid['59,31'], 2, 'a wider circle uncovers at higher kingdom visibility');
    await api('PATCH', `/api/dm/maps/${world.id}`, { visibility: 1 });
    await api('POST', `/api/dm/maps/${mapB}/set-active`);
  });

  await t.test('items.json import: adds new, skips duplicates', async () => {
    const imp = await api('POST', '/api/dm/items/import-file');
    assert.equal(imp.ok, true);
    assert.ok(imp.added >= 1, `imported ${imp.added}`);
    const again = await api('POST', '/api/dm/items/import-file');
    assert.equal(again.added, 0, 'second import skips everything');
  });

  await t.test('music: default track on set-active, soundboard nonce', async () => {
    const tr = await api('POST', '/api/dm/tracks',
      { mapId: mapB, name: 'Crypt ambience', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' });
    await api('PATCH', `/api/dm/maps/${mapB}`, { default_track_id: tr.id });
    await api('POST', `/api/dm/maps/${mapB}/set-active`);

    const tv = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tv);
    let st = await tv.next('state');
    assert.equal(st.music.playing, true, 'default track auto-starts');
    assert.equal(st.music.track.youtube_id, 'dQw4w9WgXcQ');

    const snd = await api('POST', '/api/dm/sounds', { name: 'Thunder', file: '/uploads/music/x.wav' });
    await api('POST', `/api/dm/sounds/${snd.id}/play`);
    st = await tv.latest('state');
    assert.equal(st.sfx.url, '/uploads/music/x.wav');
    assert.ok(st.sfx.nonce > 0);
  });

  await t.test('settings: custom DM password, default vision, TV link regen', async () => {
    await api('POST', '/api/dm/config', { dmPassword: 'newsecret', visionDefault: 22 });
    assert.equal((await api('POST', '/api/login', { name: '', password: 'newsecret' }, null)).role,
      'dm', 'the custom password logs in');

    const nid = (await api('POST', '/api/dm/characters', { name: 'Freshling' })).id;
    const dmSock = await connectSocket({ token: dmToken });
    cleanup.push(dmSock);
    const st = await dmSock.next('state');
    assert.equal(st.visionDefault, 22);
    assert.equal(st.dmPasswordCustom, true);
    assert.equal(st.characters.find((c) => c.id === nid).vision_radius, 22, 'new character uses the default');

    const oldKey = getConfig('spectator_key');
    await api('POST', '/api/dm/regenerate-tv-link');
    const newKey = getConfig('spectator_key');
    assert.notEqual(newKey, oldKey, 'the spectator key changed');
    await assert.rejects(connectSocket({ tvKey: oldKey }), /unauthorized/, 'the old link stops working');
    const tv = await connectSocket({ tvKey: newKey });
    cleanup.push(tv);
    assert.equal((await tv.next('state')).role, 'tv', 'the new link works');

    // restore the env password so nothing downstream depends on the override
    await api('POST', '/api/dm/config', { dmPassword: '' });
    assert.equal((await api('POST', '/api/login', { name: '', password: 'test-dm-pw' }, null)).role,
      'dm', 'clearing it restores the env password');
    await api('DELETE', `/api/dm/characters/${nid}`);
  });

  // LAST on purpose: it leaves a paced arrival timer running (unref'd + guarded),
  // which fires harmlessly after the suite tears the server down.
  await t.test('a flagged door plays a kingdom journey before the city appears', async () => {
    const world = (await (await pushedDm()).next('state')).maps.find((m) => m.is_world);
    assert.ok(world, 'a kingdom map exists');
    await api('PATCH', `/api/dm/maps/${mapA}`, { world_x: 200, world_y: 500 });
    await api('PATCH', `/api/dm/maps/${mapB}`, { world_x: 800, world_y: 500 });

    // flag the mapA <-> mapB door as a kingdom journey (both directions)
    assert.equal((await api('POST', '/api/dm/map-travel-link', { a: mapA, b: mapB, on: true })).ok, true);
    const links = (await (await pushedDm()).next('state')).mapLinks;
    assert.ok(links.some((l) =>
      ((l.map_id === mapA && l.target_map_id === mapB) || (l.map_id === mapB && l.target_map_id === mapA))
      && l.world_travel), 'the door pair is flagged in the graph data');

    // dropping on the flagged door does NOT travel — it hands back a plan so the
    // DM can draw the road first; nothing on the TV has changed yet
    await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: mapA, x: 100, y: 100 });
    const activeBefore = getConfig('active_map_id', null);
    const cueBefore = getConfig('world_travel', null)?.nonce ?? null;
    const plan = await api('POST', '/api/dm/move-token', { kind: 'character', id: hero, mapId: mapA, x: 510, y: 505 });
    assert.equal(plan.result, 'world-journey-plan', 'a flagged door asks the DM to draw the road');
    assert.deepEqual([plan.fromMapId, plan.toMapId, plan.worldId], [mapA, mapB, world.id]);
    assert.deepEqual(plan.charIds, [hero]);
    assert.equal(getConfig('active_map_id', null), activeBefore, 'nothing travels until the DM says go');
    assert.equal(getConfig('world_travel', null)?.nonce ?? null, cueBefore, 'no new journey cue yet');

    // the DM draws a road that detours north, then starts it
    const res = await api('POST', '/api/dm/world-journey', { ...plan, path: [[500, 100]] });
    assert.equal(res.ok, true);

    const tv = await connectSocket({ tvKey: getConfig('spectator_key') });
    cleanup.push(tv);
    const g = await tv.latest('state');
    assert.equal(g.activeMapId, world.id, 'the kingdom is on the TV during the trip');
    assert.ok(g.worldTravel?.nonce, 'the TV has a journey cue');
    assert.deepEqual(g.worldTravel.path, [[200, 500], [500, 100], [800, 500]],
      'the road runs town → the drawn corner → town');
    assert.ok(g.worldTravel.durationMs >= 3000, 'the journey is paced (slower than a normal walk)');
    assert.equal(g.worldTravel.arriveMapId, mapB, 'it will arrive at the destination city');
    // the detour is longer than the straight line, so it takes longer than the floor
    assert.ok(g.worldTravel.durationMs > 3000, 'a winding road takes longer than a straight one');

    // the hero has NOT arrived yet — he waits at the door on mapA
    const dmMapA = await connectAsDmMap(mapA);
    assert.ok(dmMapA.characters.some((c) => c.id === hero), 'hero waits at the door until he arrives');

    // the drawn road itself is uncovered on the kingdom map (cell near 500,100)
    const push = await tv.latest('state:map');
    assert.equal(push.fogGrid['31,6'], 2, 'the detour corner is revealed, not just the straight line');
  });
});

// Helper: fetch the DM's map detail via a throwaway socket.
async function connectAsDmMap(mapId) {
  const s = await connectSocket({ token: dmToken });
  s.socket.emit('watch', mapId);
  let detail = await s.next('state:map');
  while (detail.mapId !== mapId) detail = await s.next('state:map');
  s.close();
  return detail;
}

// Helper: a fresh DM socket (its first 'state' is the current DM global).
async function pushedDm() {
  const s = await connectSocket({ token: dmToken });
  cleanup.push(s);
  return s;
}
