export interface DormantComponent {
  readonly type: 'dormant';
  active: boolean;
  sinceMs: number;
  reason?: string;
}

export function createDormantComponent(active = true, reason?: string): DormantComponent {
  return {
    type: 'dormant',
    active,
    sinceMs: Date.now(),
    reason,
  };
}