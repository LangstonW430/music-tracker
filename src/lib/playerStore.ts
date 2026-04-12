export interface PlayerTrack {
  source_id: string;
  name: string;
  artist: string;
  image_url: string | null;
}

type Listener = () => void;

let current: PlayerTrack | null = null;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export function playTrack(track: PlayerTrack) {
  current = track;
  notify();
}

export function closePlayer() {
  current = null;
  notify();
}

export function getSnapshot(): PlayerTrack | null {
  return current;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
