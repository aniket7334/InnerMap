// Opens the Offline mode screen (components/OfflineCenter.jsx) from anywhere. Kept in its own
// module so the Online / Offline pill does not import the screen (that made a circular import).
export const OPEN_OFFLINE_CENTER = 'innermap:offline-center';
export const openOfflineCenter = () => window.dispatchEvent(new Event(OPEN_OFFLINE_CENTER));

// The Offline button already takes the user to Offline maps: the screen should not also open.
let skipModeOpen = false;
export const skipNextModeOpen = () => {
  skipModeOpen = true;
};
export const takeSkipModeOpen = () => {
  const v = skipModeOpen;
  skipModeOpen = false;
  return v;
};
