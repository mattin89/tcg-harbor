export type PortalAreaV2 = 'player' | 'store' | 'approvals';

export function preferredPortalAreaV2(input: {
  readonly roles: readonly string[];
  readonly accountKind: 'player' | 'store';
  readonly managedStoreCount: number;
}): PortalAreaV2 {
  if (input.roles.includes('platform_administrator')) return 'approvals';
  if (input.accountKind === 'store' || input.managedStoreCount > 0) return 'store';
  return 'player';
}
