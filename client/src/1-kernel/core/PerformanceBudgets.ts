export const NETWORK_PERFORMANCE_BUDGETS = {
  statusStaleWarnMs: 5000,
  snapshotFanoutWarnMs: 8,
  snapshotPayloadWarnBytes: 96 * 1024,
} as const;

export const RENDER_PERFORMANCE_BUDGETS = {
  cullPassWarnMs: 2.5,
} as const;

export const BUILD_PERFORMANCE_BUDGETS = {
  clientBundleWarnBytes: 1_200_000,
  clientBundleCriticalBytes: 1_500_000,
  clientSourceMapWarnBytes: 4_500_000,
  clientIndexHtmlWarnBytes: 4_096,
} as const;
