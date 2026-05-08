import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Phase G - Release Hardening
 * CI gating, release audit, runtime health scorecard
 */

export type RegressionGateName =
  | 'authority_violations'
  | 'replay_drift'
  | 'listener_leaks'
  | 'entity_duplication'
  | 'memory_growth'
  | 'frame_budget'
  | 'orphaned_jobs'
  | 'determinism_failures';

export interface RegressionGate {
  name: RegressionGateName;
  passed: boolean;
  message: string;
  severity: 'critical' | 'warning';
}

export class CIGateValidator {
  private gates: Map<RegressionGateName, RegressionGate> = new Map();

  recordGate(gate: RegressionGate): void {
    this.gates.set(gate.name, gate);
  }

  allGatesPassed(): boolean {
    for (const gate of this.gates.values()) {
      if (!gate.passed && gate.severity === 'critical') {
        return false;
      }
    }
    return true;
  }

  getCriticalFailures(): RegressionGate[] {
    return Array.from(this.gates.values()).filter((g) => !g.passed && g.severity === 'critical');
  }

  getWarnings(): RegressionGate[] {
    return Array.from(this.gates.values()).filter((g) => !g.passed && g.severity === 'warning');
  }

  generateReport(): string {
    const lines: string[] = ['# CI Gate Report'];
    lines.push(`Total gates: ${this.gates.size}`);
    lines.push(`Passed: ${Array.from(this.gates.values()).filter((g) => g.passed).length}`);

    const failures = this.getCriticalFailures();
    if (failures.length > 0) {
      lines.push('\n## Critical Failures');
      for (const gate of failures) {
        lines.push(`- ${gate.name}: ${gate.message}`);
      }
    }

    const warnings = this.getWarnings();
    if (warnings.length > 0) {
      lines.push('\n## Warnings');
      for (const gate of warnings) {
        lines.push(`- ${gate.name}: ${gate.message}`);
      }
    }

    lines.push(`\nResult: ${this.allGatesPassed() ? 'PASS' : 'FAIL'}`);
    return lines.join('\n');
  }
}

/**
 * Runtime Health Scorecard
 * Tracks overall runtime health across phases
 */

export type HealthMetric = 'authority' | 'determinism' | 'streaming' | 'scale' | 'observability' | 'safety';

export interface HealthScore {
  metric: HealthMetric;
  score: number; // 0-100
  status: 'healthy' | 'warning' | 'critical';
  details: string;
}

export class RuntimeHealthScorecard {
  private scores: Map<HealthMetric, HealthScore> = new Map();

  recordScore(score: HealthScore): void {
    this.scores.set(score.metric, score);
  }

  computeOverallScore(): number {
    if (this.scores.size === 0) return 0;

    let total = 0;
    for (const score of this.scores.values()) {
      total += score.score;
    }

    return total / this.scores.size;
  }

  getHealthStatus(): 'production-ready' | 'staging-ready' | 'needs-work' {
    const overall = this.computeOverallScore();

    if (overall >= 95) return 'production-ready';
    if (overall >= 80) return 'staging-ready';
    return 'needs-work';
  }

  generateScorecard(): string {
    const lines: string[] = ['# Runtime Health Scorecard'];
    lines.push(`Date: ${new Date().toISOString()}`);

    for (const score of this.scores.values()) {
      lines.push(`\n## ${score.metric.toUpperCase()}`);
      lines.push(`Score: ${score.score}/100`);
      lines.push(`Status: ${score.status}`);
      lines.push(`Details: ${score.details}`);
    }

    const overall = this.computeOverallScore();
    const status = this.getHealthStatus();
    lines.push(`\n## Overall`);
    lines.push(`Score: ${overall.toFixed(1)}/100`);
    lines.push(`Status: ${status}`);

    return lines.join('\n');
  }
}

/**
 * Release Readiness Validator
 * Comprehensive pre-release checklist
 */

export interface ReleaseChecklistItem {
  name: string;
  completed: boolean;
  notes: string;
}

export class ReleaseReadinessValidator {
  private checklist: Map<string, ReleaseChecklistItem> = new Map();

  private static DEFAULT_ITEMS = [
    'Authority enforcement gated and passing',
    'Replay determinism validated and stable',
    'Streaming leaks detected and zero',
    'Scale benchmarks within budget',
    'Frame budget validated and compliant',
    'Memory growth tracked and acceptable',
    'Observability tooling operational',
    'Content validation pipeline active',
    'Mod safety checks passing',
    'CI gates fully configured',
    'Documentation complete and accurate',
    'Performance regression tests gating',
  ];

  constructor() {
    for (const item of ReleaseReadinessValidator.DEFAULT_ITEMS) {
      this.checklist.set(item, { name: item, completed: false, notes: '' });
    }
  }

  markComplete(itemName: string, notes = ''): void {
    const item = this.checklist.get(itemName);
    if (item) {
      item.completed = true;
      item.notes = notes;
    }
  }

  isReadyForRelease(): boolean {
    for (const item of this.checklist.values()) {
      if (!item.completed) return false;
    }
    return true;
  }

  getCompletionStatus(): { completed: number; total: number; percentage: number } {
    const completed = Array.from(this.checklist.values()).filter((i) => i.completed).length;
    const total = this.checklist.size;

    return {
      completed,
      total,
      percentage: (completed / total) * 100,
    };
  }

  generateChecklist(): string {
    const lines: string[] = ['# Release Readiness Checklist'];
    const status = this.getCompletionStatus();
    lines.push(`Progress: ${status.completed}/${status.total} (${status.percentage.toFixed(0)}%)\n`);

    for (const item of this.checklist.values()) {
      const checkbox = item.completed ? '[x]' : '[ ]';
      lines.push(`${checkbox} ${item.name}`);
      if (item.notes) {
        lines.push(`    Note: ${item.notes}`);
      }
    }

    return lines.join('\n');
  }
}

describe('Phase G - Release Hardening', () => {
  describe('CIGateValidator', () => {
    let validator: CIGateValidator;

    beforeEach(() => {
      validator = new CIGateValidator();
    });

    it('passes when all critical gates pass', () => {
      validator.recordGate({
        name: 'authority_violations',
        passed: true,
        message: 'No violations',
        severity: 'critical',
      });

      validator.recordGate({
        name: 'replay_drift',
        passed: true,
        message: 'Stable',
        severity: 'critical',
      });

      expect(validator.allGatesPassed()).toBe(true);
    });

    it('fails when critical gate fails', () => {
      validator.recordGate({
        name: 'authority_violations',
        passed: false,
        message: 'Found violations',
        severity: 'critical',
      });

      expect(validator.allGatesPassed()).toBe(false);
    });

    it('ignores failed warnings', () => {
      validator.recordGate({
        name: 'authority_violations',
        passed: true,
        message: 'No violations',
        severity: 'critical',
      });

      validator.recordGate({
        name: 'memory_growth',
        passed: false,
        message: 'Minor growth',
        severity: 'warning',
      });

      expect(validator.allGatesPassed()).toBe(true);
      expect(validator.getWarnings()).toHaveLength(1);
    });

    it('reports critical failures', () => {
      validator.recordGate({
        name: 'authority_violations',
        passed: false,
        message: 'Found violations',
        severity: 'critical',
      });

      const failures = validator.getCriticalFailures();
      expect(failures).toHaveLength(1);
    });

    it('generates report', () => {
      validator.recordGate({
        name: 'authority_violations',
        passed: true,
        message: 'No violations',
        severity: 'critical',
      });

      const report = validator.generateReport();
      expect(report).toContain('CI Gate Report');
      expect(report).toContain('PASS');
    });
  });

  describe('RuntimeHealthScorecard', () => {
    let scorecard: RuntimeHealthScorecard;

    beforeEach(() => {
      scorecard = new RuntimeHealthScorecard();
    });

    it('computes overall health score', () => {
      scorecard.recordScore({
        metric: 'authority',
        score: 100,
        status: 'healthy',
        details: 'All authority rules enforced',
      });

      scorecard.recordScore({
        metric: 'determinism',
        score: 90,
        status: 'healthy',
        details: 'Determinism replays stable',
      });

      const overall = scorecard.computeOverallScore();
      expect(overall).toBe(95);
    });

    it('assigns production-ready status on high score', () => {
      scorecard.recordScore({
        metric: 'authority',
        score: 100,
        status: 'healthy',
        details: 'Perfect',
      });

      expect(scorecard.getHealthStatus()).toBe('production-ready');
    });

    it('assigns staging-ready status on medium score', () => {
      scorecard.recordScore({
        metric: 'authority',
        score: 85,
        status: 'healthy',
        details: 'Good',
      });

      expect(scorecard.getHealthStatus()).toBe('staging-ready');
    });

    it('generates scorecard report', () => {
      scorecard.recordScore({
        metric: 'authority',
        score: 100,
        status: 'healthy',
        details: 'Enforced',
      });

      const report = scorecard.generateScorecard();
      expect(report).toContain('Runtime Health Scorecard');
      expect(report.toLowerCase()).toContain('authority');
    });
  });

  describe('ReleaseReadinessValidator', () => {
    let validator: ReleaseReadinessValidator;

    beforeEach(() => {
      validator = new ReleaseReadinessValidator();
    });

    it('starts with all items incomplete', () => {
      const status = validator.getCompletionStatus();
      expect(status.completed).toBe(0);
      expect(status.percentage).toBe(0);
    });

    it('marks items complete', () => {
      validator.markComplete('Authority enforcement gated and passing', 'All gates passing');

      const status = validator.getCompletionStatus();
      expect(status.completed).toBe(1);
      expect(status.percentage).toBeGreaterThan(0);
    });

    it('is not ready until all items complete', () => {
      expect(validator.isReadyForRelease()).toBe(false);
    });

    it('is ready when all items complete', () => {
      const items = [
        'Authority enforcement gated and passing',
        'Replay determinism validated and stable',
        'Streaming leaks detected and zero',
        'Scale benchmarks within budget',
        'Frame budget validated and compliant',
        'Memory growth tracked and acceptable',
        'Observability tooling operational',
        'Content validation pipeline active',
        'Mod safety checks passing',
        'CI gates fully configured',
        'Documentation complete and accurate',
        'Performance regression tests gating',
      ];

      for (const item of items) {
        validator.markComplete(item);
      }

      expect(validator.isReadyForRelease()).toBe(true);
    });

    it('generates checklist', () => {
      validator.markComplete('Authority enforcement gated and passing');

      const checklist = validator.generateChecklist();
      expect(checklist).toContain('Release Readiness Checklist');
      expect(checklist).toContain('[x]');
      expect(checklist).toContain('[ ]');
    });
  });
});
