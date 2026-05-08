export interface NetworkMessageEnvelope<TType extends string = string, TData = Record<string, unknown>> {
  type: TType;
  data?: TData;
  timestamp?: number;
}

export interface HordeStartRequestMessage {
  type: 'HORDE_START_REQUEST';
  data: Record<string, never>;
}

export interface HordeStartConfirmedMessage {
  type: 'HORDE_START_CONFIRMED';
  playerId: string;
  timestamp: number;
}
