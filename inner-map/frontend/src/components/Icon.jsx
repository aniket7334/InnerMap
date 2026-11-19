// Minimal inline SVG icon set (no external icon font, so it works offline).
const PATHS = {
  dashboard: 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z',
  map: 'M9 3 3 5.5v15L9 18l6 2.5 6-2.5v-15L15 6 9 3zm0 2.2 6 2.5v12.1l-6-2.5V5.2z',
  download: 'M12 3v11m0 0 4.5-4.5M12 14 7.5 9.5M4 17v3h16v-3',
  layers: 'm12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5M3 16l9 5 9-5',
  pin: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zm0-9a3 3 0 1 1 0-6 3 3 0 0 1 0 6z',
  expand: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  shrink: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a3 3 0 0 1 3-3h7M18 9v6a3 3 0 0 1-3 3H8',
  navigation:'M12 3 5 20l7-4 7 4-7-17z',
  chevron: 'm9 6 6 6-6 6',
  globe:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  path:'M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm14-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6.5 15.5l4-6 3 4 4-6',
  user: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm-8 9c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  crosshair: 'M12 2v4m0 12v4M2 12h4m12 0h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  wifi: 'M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01',
  wifiOff: 'M2 2l20 20M8.5 15.5a5 5 0 0 1 7 0M5 12a10 10 0 0 1 5-2.6M14.5 9.6A10 10 0 0 1 19 12M2 8.5a15 15 0 0 1 4.3-2.8M12 19h.01',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  play: 'M7 4v16l13-8z',
  stop: 'M6 6h12v12H6z',
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6 6 18',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3-4.5-4.5',
  text: 'M5 7V4h14v3M12 4v16M9 20h6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  ruler: 'M3 17 17 3l4 4L7 21l-4-4zm4-2 2 2m1-5 2 2m1-5 2 2m1-5 2 2',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm3.5-12.5-2 5-5 2 2-5 5-2z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0-14v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  chevronDown: 'm6 9 6 6 6-6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  food: 'M7 3v8m-3-8v4a3 3 0 0 0 6 0V3M7 11v10m10-18c-2 1-3 3-3 6v4h3m0-10v18',
  bed: 'M3 18V7m0 7h18v4M3 11h7v3m11 0v-2a3 3 0 0 0-3-3h-8',
  medical: 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z',
  fuel: 'M4 20V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15M3 20h12M4 10h10M14 9l3-2 2 2v8a1.5 1.5 0 0 1-3 0v-3h-2',
  bag: 'M5 8h14l-1 12H6L5 8zm4 0V6a3 3 0 0 1 6 0v2',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5M12 7v5l3 2',
  route2: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a3 3 0 0 1 3-3h7M18 9v6a3 3 0 0 1-3 3H8',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  cloudDown: 'M7 18a5 5 0 0 1-.7-9.9A6 6 0 0 1 18 9a4.5 4.5 0 0 1 .5 9M12 12v8m0 0-3-3m3 3 3-3',
  photo: 'M4 6h3l1.5-2h7L17 6h3v13H4V6zm8 10.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zm-8 3v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
};

export default function Icon({ name, size = 18, className = '' }) {
  const d = PATHS[name];
  if (!d) return null;
  const filled = ['dashboard', 'play', 'stop'].includes(name);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`icon ${className}`}
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}
