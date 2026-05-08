/**
 * initTransactionalKernel.ts
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Simple factory: Initialize a SimulationKernel with TransactionalKernelMode.
 *
 * Use this instead of `new SimulationKernel()` when you want:
 * ✅ PHASE_COLLECT → PHASE_RESOLVE enforcement
 * ✅ State hash validation
 * ✅ Audit system for corruption detection
 */

import { SimulationKernel, type SimulationKernelConfig } from './SimulationKernel';
import { TransactionalKernelMode } from './TransactionalKernelMode';
import { KernelAuditSystem, createAuditSystemForKernel } from './KernelAuditSystem';
import { Float32BufferProxy, Int32BufferProxy, type DODBufferProxyConfig } from './DODBufferProxy';

/**
 * Initialize kernel with transactional mode.
 * Returns both kernel + transactional executor for use in your game loop.
 */
export function initTransactionalKernel(config: SimulationKernelConfig): {
  kernel: SimulationKernel;
  transactional: TransactionalKernelMode;
} {
  const kernel = new SimulationKernel(config);
  const enableDevGuards = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';

  // Guard layer configuration
  const proxyConfig: DODBufferProxyConfig = {
    enableAssertions: enableDevGuards,
    enableShadowBuffer: enableDevGuards,
  };

  // Wrap buffers with guard proxies
  const posProxy = new Float32BufferProxy(
    kernel.positions.getWriteBuffer(),
    kernel.entities,
    proxyConfig,
    'positions'
  );

  const velProxy = new Float32BufferProxy(
    kernel.velocities.getBuffer(),
    kernel.entities,
    proxyConfig,
    'velocities'
  );

  const healthProxy = new Float32BufferProxy(
    kernel.healths.getHealthBuffer(),
    kernel.entities,
    proxyConfig,
    'healths'
  );

  const ammoProxy = new Int32BufferProxy(
    kernel.inventories.getAmmoBuffer() as any as Int32Array,
    kernel.entities,
    proxyConfig,
    'ammos'
  );

  // Create audit system with shadow buffers
  const audit = createAuditSystemForKernel(proxyConfig, posProxy, velProxy, healthProxy, ammoProxy);

  // Create transactional executor
  const transactional = new TransactionalKernelMode(
    kernel.entities,
    kernel.commands,
    audit,
    posProxy,
    velProxy,
    healthProxy,
    ammoProxy
  );

  return { kernel, transactional };
}
