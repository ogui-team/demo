import { registerSystem, registerSystemMetadata } from '@engine/1-kernel/core/public-api';

interface RuntimeAuditStatus {
  enabled: boolean;
  reportLoaded: boolean;
  reportPath: string;
  totalSystems: number;
  systemsWithIssues: number;
  missingReplication: number;
  missingEventBus: number;
  missingDebugIntegration: number;
  declaredDetectedMismatches: number;
  directCouplingViolations: number;
  systemsUsingSystemContext: number;
  systemsUsingNetworkFacade: number;
  averageHealthScore: number;
  lastError: string | null;
}

const status: RuntimeAuditStatus = {
  enabled: false,
  reportLoaded: false,
  reportPath: 'engine/reports/ENGINE_CAPABILITY_LATEST.json',
  totalSystems: 0,
  systemsWithIssues: 0,
  missingReplication: 0,
  missingEventBus: 0,
  missingDebugIntegration: 0,
  declaredDetectedMismatches: 0,
  directCouplingViolations: 0,
  systemsUsingSystemContext: 0,
  systemsUsingNetworkFacade: 0,
  averageHealthScore: 0,
  lastError: null,
};

let initialized = false;

export function runRuntimeCapabilityAuditHook(): void {
  const env = readEnvValue('DEBUG_ENGINE_AUDIT');
  if (!env) return;
  if (initialized) return;
  initialized = true;

  status.enabled = true;

  registerSystem('engineCapabilityAudit', {
    getDiagnostics: () => ({ ...status }),
  });

  registerSystemMetadata('engineCapabilityAudit', {
    displayName: 'Engine Capability Audit',
    category: 'Diagnostics',
    order: 5,
    getState: () => ({ ...status }),
  });

  console.info('[EngineAudit] DEBUG_ENGINE_AUDIT enabled. Loading latest capability report snapshot...');
  void loadReportSnapshot();
}

async function loadReportSnapshot(): Promise<void> {
  try {
    const response = await fetch(`/${status.reportPath}`);
    if (!response.ok) {
      status.lastError = `Report fetch failed: ${response.status}`;
      return;
    }

    const payload = (await response.json()) as {
      summary?: {
        totalSystems?: number;
        systemsWithIssues?: number;
        missingReplication?: number;
        missingEventBus?: number;
        missingDebugIntegration?: number;
        declaredDetectedMismatches?: number;
        directCouplingViolations?: number;
        systemsUsingSystemContext?: number;
        systemsUsingNetworkFacade?: number;
        averageHealthScore?: number;
      };
    };

    status.reportLoaded = true;
    status.totalSystems = payload.summary?.totalSystems ?? 0;
    status.systemsWithIssues = payload.summary?.systemsWithIssues ?? 0;
    status.missingReplication = payload.summary?.missingReplication ?? 0;
    status.missingEventBus = payload.summary?.missingEventBus ?? 0;
    status.missingDebugIntegration = payload.summary?.missingDebugIntegration ?? 0;
    status.declaredDetectedMismatches = payload.summary?.declaredDetectedMismatches ?? 0;
    status.directCouplingViolations = payload.summary?.directCouplingViolations ?? 0;
    status.systemsUsingSystemContext = payload.summary?.systemsUsingSystemContext ?? 0;
    status.systemsUsingNetworkFacade = payload.summary?.systemsUsingNetworkFacade ?? 0;
    status.averageHealthScore = payload.summary?.averageHealthScore ?? 0;
    status.lastError = null;
  } catch (error) {
    status.lastError = error instanceof Error ? error.message : String(error);
  }
}

function readEnvValue(key: string): string | undefined {
  const candidate = (globalThis as any)?.process?.env?.[key];
  if (typeof candidate === 'string') return candidate;
  return undefined;
}
