/**
 * The slice of `react-native` the HEADLESS client touches, stubbed for node.
 * The UI components are deliberately not covered here - they get a
 * types-compile check only, because node has no RN renderer to mount them in.
 */
export const Dimensions = {
  get: () => ({ width: 390, height: 844 }),
};

export const Platform = {
  OS: "ios",
  Version: "17.0",
  select: (options) => options.default ?? options.ios,
};

export const Appearance = {
  getColorScheme: () => "light",
};
