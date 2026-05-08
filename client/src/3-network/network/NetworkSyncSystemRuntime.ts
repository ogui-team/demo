import {
  processAuthoritativeInputs as processAuthoritativeInputsImpl,
  applyLiveLocalInput as applyLiveLocalInputImpl,
  broadcastSnapshot as broadcastSnapshotImpl,
  captureHistoryFrame as captureHistoryFrameImpl,
} from './NetworkSyncRuntime';
import { applyPositionErrorDecay as applyPositionErrorDecayImpl } from './NetworkSyncVisualCorrection';

export function updateNetworkSyncSystem(context: any, dt: number): void {
  context.ensureLocalPlayerBinding();
  context.flushPendingNetworkMappings();
  context.applyPositionErrorDecay(dt);

  context.fixedAccumulator += dt;
  while (context.fixedAccumulator >= context.fixedStep) {
    context.fixedAccumulator -= context.fixedStep;
    context.tick += 1;

    if (context.authorityMode === 'remote' && context.predictionEnabled) {
      context.applyLiveLocalInput(context.fixedStep);
    }

    if (context.authorityMode === 'local' && context.simulateAuthority) {
      context.processAuthoritativeInputs();
      context.broadcastSnapshot();
      context.captureHistoryFrame();
    }
  }
}

export function processAuthoritativeInputs(context: any): void {
  processAuthoritativeInputsImpl(context);
}

export function applyLiveLocalInput(context: any, dt: number): void {
  applyLiveLocalInputImpl(context, dt);
}

export function broadcastSnapshot(context: any): void {
  broadcastSnapshotImpl(context);
}

export function captureHistoryFrame(context: any): void {
  captureHistoryFrameImpl(context);
}

export function applyPositionErrorDecay(context: any, dt: number): void {
  applyPositionErrorDecayImpl(context, dt);
}
