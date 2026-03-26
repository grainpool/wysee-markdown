export const ERROR_CODES = {
  versionMismatch: 'WMD-EDT-409',
  renderFailed: 'WMD-RND-500',
  securitySanitized: 'WMD-SEC-201',
  spellUnavailable: 'WMD-SPL-503',
  printBindFailed: 'WMD-PRN-101',
  printLaunchFailed: 'WMD-PRN-201',
  exportFailed: 'WMD-EXP-500',
  contextMissing: 'WMD-CTX-404',
  trustRequired: 'WMD-TRU-403',
} as const;
