// Opens the Offline mode screen (components/OfflineCenter.jsx) from anywhere. Kept in its own
// module so the Online / Offline pill does not import the screen (that made a circular import).
export const OPEN_OFFLINE_CENTER = 'innermap:offline-center';
export const openOfflineCenter = () => window.dispatchEvent(new Event(OPEN_OFFLINE_CENTER));
