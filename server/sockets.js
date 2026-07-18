// Socket.IO wiring. Clients authenticate in the connection handshake
// (auth: {token} for DM/players, {tvKey} for the spectator screen) and then
// only ever RECEIVE state — all mutations go through the REST API.
// A client tells us which map it is rendering via 'watch' so map detail
// pushes go only where they're needed.
import { Server } from 'socket.io';
import { viewerFromCredentials } from './auth.js';
import { bindIO, globalStateFor, mapPayloadFor } from './state.js';
import { getConfig, getMap } from './db.js';

export function setupSockets(httpServer) {
  const io = new Server(httpServer, { serveClient: false });
  bindIO(io);

  io.use((socket, next) => {
    const viewer = viewerFromCredentials(socket.handshake.auth || {});
    if (!viewer) return next(new Error('unauthorized'));
    socket.data.viewer = viewer;
    next();
  });

  io.on('connection', (socket) => {
    const viewer = socket.data.viewer;

    // TV always watches the active map; re-pointed automatically when the DM
    // changes it (see pushAll callers after set-active).
    if (viewer.role === 'tv') {
      socket.data.watchMapId = getConfig('active_map_id', null);
    }

    socket.emit('state', globalStateFor(viewer));
    if (socket.data.watchMapId) {
      socket.emit('state:map', mapPayloadFor(viewer, socket.data.watchMapId));
    }

    socket.on('watch', (mapId) => {
      // TV ignores manual watch requests; it is pinned to the active map.
      if (viewer.role === 'tv') return;
      socket.data.watchMapId = getMap(mapId) ? mapId : null;
      if (socket.data.watchMapId) {
        socket.emit('state:map', mapPayloadFor(viewer, socket.data.watchMapId));
      }
    });
  });

  return io;
}

// Keep TV sockets pinned to the active map; call after active_map_id changes.
export function retargetTVs(io) {
  const activeId = getConfig('active_map_id', null);
  for (const [, socket] of io.sockets.sockets) {
    if (socket.data.viewer?.role === 'tv') socket.data.watchMapId = activeId;
  }
}
