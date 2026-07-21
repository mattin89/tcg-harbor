import type { SVGProps } from 'react';

type IconName = 'dashboard' | 'collection' | 'plus' | 'store' | 'users' | 'message' | 'settings' | 'search' | 'bell' | 'chevron' | 'arrow-up' | 'arrow-down' | 'cards' | 'box' | 'chart' | 'clock' | 'grid' | 'list' | 'filter' | 'close' | 'edit' | 'trash' | 'map' | 'locate' | 'scan' | 'qr' | 'send' | 'trade' | 'check' | 'more' | 'logout' | 'shield' | 'camera' | 'upload' | 'lock' | 'sparkle' | 'menu' | 'download' | 'copy' | 'refresh' | 'info';

const paths: Record<IconName, React.ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="4" rx="2"/><rect x="14" y="11" width="7" height="10" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/></>,
  collection: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v18M13 7h3M13 11h3"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  store: <><path d="M3 9h18l-2-5H5L3 9Z"/><path d="M5 9v11h14V9M9 20v-6h6v6"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  message: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"/><path d="M8 9h8M8 13h5"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9c.13.62.65 1 1.55 1H21v4h-.08c-.9 0-1.42.38-1.52 1Z"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  'arrow-up': <><path d="m18 15-6-6-6 6"/><path d="M12 9v10"/></>,
  'arrow-down': <><path d="m6 9 6 6 6-6"/><path d="M12 5v10"/></>,
  cards: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="m9 7 3 3 3-3M8 15h8"/></>,
  box: <><path d="m21 8-9 5-9-5 9-5 9 5Z"/><path d="m3 8 9 5 9-5v9l-9 5-9-5V8Z"/><path d="M12 13v9"/></>,
  chart: <><path d="M3 3v18h18"/><path d="m7 16 4-5 3 3 5-7"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r=".5"/><circle cx="3.5" cy="12" r=".5"/><circle cx="3.5" cy="18" r=".5"/></>,
  filter: <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z"/></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/></>,
  map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/></>,
  locate: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></>,
  scan: <><path d="M3 8V4a1 1 0 0 1 1-1h4M16 3h4a1 1 0 0 1 1 1v4M21 16v4a1 1 0 0 1-1 1h-4M8 21H4a1 1 0 0 1-1-1v-4"/><path d="M7 12h10"/></>,
  qr: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM18 14h3M14 18v3"/></>,
  send: <><path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/></>,
  trade: <><path d="M7 7h11l-3-3M18 17H7l3 3"/><path d="M18 7 15 4M7 17l3 3"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h7v18h-7"/></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
  camera: <><path d="M3 7h4l2-3h6l2 3h4v13H3V7Z"/><circle cx="12" cy="13" r="4"/></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  sparkle: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z"/><path d="m19 14 .7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14Z"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  download: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2 5.3"/><path d="M20 4v7h-7"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
};

export function Icon({ name, size = 20, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
