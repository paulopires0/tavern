import React, { useEffect, useRef } from 'react';

// Small embedded YouTube player (the TV's music speaker). Needs internet at
// game time; the DM only pastes links. Rendered as a small visible tile so
// it complies with embed rules and doubles as a "now playing" indicator.
let ytPromise = null;
function loadYT() {
  if (!ytPromise) {
    ytPromise = new Promise((resolve) => {
      if (window.YT?.Player) return resolve(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.onerror = () => resolve(null); // offline: fail quiet
      document.head.appendChild(tag);
    });
  }
  return ytPromise;
}

export default function YouTubePlayer({ videoId, playing }) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const stateRef = useRef({ videoId: null, ready: false });

  useEffect(() => {
    let cancelled = false;
    loadYT().then((YT) => {
      if (cancelled || !YT || !hostRef.current) return;
      playerRef.current = new YT.Player(hostRef.current, {
        width: '100%', height: '100%', videoId,
        playerVars: { autoplay: 0, loop: 1, playlist: videoId, controls: 0 },
        events: { onReady: () => { stateRef.current.ready = true; stateRef.current.videoId = videoId; sync(); } },
      });
    });
    return () => { cancelled = true; try { playerRef.current?.destroy(); } catch { /* gone */ } };
  }, []);

  function sync() {
    const p = playerRef.current;
    if (!p || !stateRef.current.ready) return;
    try {
      if (videoId && stateRef.current.videoId !== videoId) {
        stateRef.current.videoId = videoId;
        p.loadVideoById(videoId);
        if (!playing) p.pauseVideo();
        return;
      }
      if (playing) p.playVideo();
      else p.pauseVideo();
    } catch { /* player mid-teardown */ }
  }
  useEffect(sync, [videoId, playing]);

  return <div className="yt-tile"><div ref={hostRef} /></div>;
}
