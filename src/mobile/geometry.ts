export type MobileDeviceGeometry = {
  device: {
    width: number;
    height: number;
  };
  screen: {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
  };
  safeArea: {
    top: number;
    bottom: number;
  };
  keyboard: {
    height: number;
  };
};

export const compactGeometry = {
  device: {
    width: 429,
    height: 888,
  },
  screen: {
    x: 18,
    y: 18,
    width: 393,
    height: 852,
    radius: 34,
  },
  safeArea: {
    top: 50,
    bottom: 32,
  },
  keyboard: {
    height: 300,
  },
} as const satisfies MobileDeviceGeometry;

export const tallGeometry = {
  device: {
    width: 467,
    height: 992,
  },
  screen: {
    x: 20,
    y: 20,
    width: 427,
    height: 952,
    radius: 38,
  },
  safeArea: {
    top: 56,
    bottom: 40,
  },
  keyboard: {
    height: 304,
  },
} as const satisfies MobileDeviceGeometry;

export type CompactGeometry = typeof compactGeometry;
