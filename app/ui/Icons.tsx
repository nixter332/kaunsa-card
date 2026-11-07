// Small stroke icons, drawn for this app.
type P = { size?: number };
const svg = (size: number, children: React.ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const IconPay = ({ size = 22 }: P) => svg(size, <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>);
export const IconCards = ({ size = 22 }: P) =>
  svg(size, <><rect x="3" y="6" width="15" height="10" rx="2" /><path d="M6 19h13a2 2 0 0 0 2-2V9" /><path d="M3 10h15" /></>);
export const IconSavings = ({ size = 22 }: P) => svg(size, <><path d="M4 19V9" /><path d="M10 19V5" /><path d="M16 19v-7" /><path d="M21 19H3" /></>);
export const IconSettings = ({ size = 22 }: P) =>
  svg(size, <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>);
export const IconBack = ({ size = 22 }: P) => svg(size, <path d="M15 5l-7 7 7 7" />);
export const IconClose = ({ size = 22 }: P) => svg(size, <path d="M6 6l12 12M18 6 6 18" />);
export const IconCheck = ({ size = 18 }: P) => svg(size, <path d="m5 12 5 5 9-10" />);
export const IconArrowUp = ({ size = 20 }: P) => svg(size, <><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></>);
export const IconDelete = ({ size = 22 }: P) => svg(size, <><path d="M9 6h11v12H9l-6-6z" /><path d="m13 10 4 4M17 10l-4 4" /></>);

const tileIcons: Record<string, React.ReactNode> = {
  food: <><path d="M4 11h16a8 8 0 0 1-16 0Z" /><path d="M9 7c0-1.5 1-2 1-3M13 7c0-1.5 1-2 1-3" /></>,
  dining: <><path d="M7 3v8a2 2 0 0 0 2 2v8" /><path d="M11 3v6" /><path d="M17 21V3c-2 1-3 4-3 8h3" /></>,
  grocery: <><path d="M4 7h16l-1.5 11.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5Z" /><path d="M9 10V6a3 3 0 0 1 6 0v4" /></>,
  shopping: <><path d="M6 8h12l1 12H5Z" /><path d="M9 8a3 3 0 0 1 6 0" /></>,
  travel: <><path d="M3 15l18-7-4 11-5-3-3 4v-6" /></>,
  bills: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6M9 12h6" /></>,
  upi: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2v2M20 14v6h-6v-2" /></>,
  fuel: <><path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" /><path d="M4 21h12M15 9h2l2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3" /><path d="M8 7h4" /></>,
};
export const TileIcon = ({ id, size = 22 }: { id: string; size?: number }) => svg(size, tileIcons[id] ?? tileIcons.shopping);
