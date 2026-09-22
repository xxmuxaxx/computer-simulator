export interface Wallpaper {
  id: string;
  name: string;
  background: string;
}

export const WALLPAPERS: Wallpaper[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    background:
      'radial-gradient(1200px 700px at 15% 10%, #3b5bdb55, transparent 60%), radial-gradient(900px 600px at 85% 85%, #12b88666, transparent 60%), linear-gradient(160deg, #12162b, #1b2444 55%, #0e2a3a)',
  },
  {
    id: 'sunset',
    name: 'Sunset',
    background:
      'radial-gradient(1000px 600px at 80% 0%, #ff8a5c88, transparent 60%), radial-gradient(900px 700px at 0% 100%, #a855f766, transparent 60%), linear-gradient(170deg, #2b1740, #5b2a5e 50%, #c2456b)',
  },
  {
    id: 'forest',
    name: 'Forest',
    background:
      'radial-gradient(900px 600px at 20% 90%, #34d39955, transparent 60%), linear-gradient(160deg, #0d2b22, #14513c 55%, #1f7a55)',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    background:
      'radial-gradient(1000px 600px at 70% 10%, #38bdf877, transparent 60%), linear-gradient(170deg, #06213d, #0b4a7a 55%, #1287a8)',
  },
  {
    id: 'graphite',
    name: 'Graphite',
    background: 'radial-gradient(900px 600px at 50% 0%, #4b556355, transparent 65%), linear-gradient(160deg, #15171d, #23262f 60%, #2f333e)',
  },
  {
    id: 'daylight',
    name: 'Daylight',
    background:
      'radial-gradient(900px 600px at 80% 0%, #ffe8a355, transparent 60%), linear-gradient(170deg, #cfe3ff, #e8effc 55%, #f7f3ea)',
  },
];

export function getWallpaper(id: string): Wallpaper {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0]!;
}
