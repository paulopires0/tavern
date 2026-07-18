import { io } from 'socket.io-client';

// One socket per view. `auth` is {token} for players/DM or {tvKey} for the TV.
export function connectSocket(auth) {
  return io('/', { auth });
}
