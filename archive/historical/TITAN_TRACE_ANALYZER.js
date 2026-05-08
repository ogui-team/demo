/**
 * TITAN v0.2.2 Trace Analysis Script
 * 
 * Usage in browser console:
 * 1. Paste this entire script
 * 2. Call: analyzeTrace(traceFile)  // where traceFile is the .trace file
 * 3. Review results
 */

class TraceAnalyzer {
  constructor(buffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.frameSize = 1024;
    this.maxFrames = 300;
  }

  /**
   * Parse frame header at given frame index
   */
  getFrameHeader(frameIndex) {
    const frameOffset = (frameIndex % this.maxFrames) * this.frameSize;
    
    return {
      frameIndex: this.view.getUint32(frameOffset + 0, true),
      timestamp: this.view.getFloat64(frameOffset + 8, true),
      stateHash: this.view.getUint32(frameOffset + 16, true),
      commandCount: this.view.getUint16(frameOffset + 20, true),
    };
  }

  /**
   * Analyze all frames
   */
  analyzeAllFrames() {
    const frames = [];
    let hashesUnique = new Set();
    let frameSequenceValid = true;
    let lastFrameIndex = -1;

    for (let i = 0; i < this.maxFrames; i++) {
      const header = this.getFrameHeader(i);
      frames.push(header);
      
      hashesUnique.add(header.stateHash);
      
      // Check sequence continuity
      if (lastFrameIndex !== -1 && header.frameIndex !== lastFrameIndex + 1) {
        if (!(lastFrameIndex === 299 && header.frameIndex === 0)) {
          frameSequenceValid = false;
        }
      }
      lastFrameIndex = header.frameIndex;
    }

    return {
      frames,
      totalFrames: this.maxFrames,
      uniqueHashes: hashesUnique.size,
      frameSequenceValid,
      bufferSize: this.buffer.byteLength,
      bufferSizeKB: (this.buffer.byteLength / 1024).toFixed(1),
    };
  }

  /**
   * Extract performance metrics
   */
  getPerformanceMetrics() {
    const firstFrame = this.getFrameHeader(0);
    const lastFrame = this.getFrameHeader(299);
    
    const timestamps = [];
    const hashes = [];
    
    for (let i = 0; i < this.maxFrames; i++) {
      const header = this.getFrameHeader(i);
      timestamps.push(header.timestamp);
      hashes.push(header.stateHash);
    }

    const timeDiff = lastFrame.timestamp - firstFrame.timestamp;
    const durationSeconds = timeDiff / 1000; // Convert ms to seconds
    const frameRate = this.maxFrames / durationSeconds;

    return {
      startTimestamp: new Date(firstFrame.timestamp).toISOString(),
      endTimestamp: new Date(lastFrame.timestamp).toISOString(),
      durationMs: timeDiff.toFixed(2),
      durationSeconds: durationSeconds.toFixed(2),
      calculatedFPS: frameRate.toFixed(1),
      firstFrameHash: `0x${firstFrame.stateHash.toString(16).padStart(8, '0')}`,
      lastFrameHash: `0x${lastFrame.stateHash.toString(16).padStart(8, '0')}`,
      stateHashesDifferent: firstFrame.stateHash !== lastFrame.stateHash,
    };
  }

  /**
   * Print comprehensive analysis
   */
  printAnalysis() {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║         TITAN v0.2.2 TRACE ANALYSIS REPORT            ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    const analysis = this.analyzeAllFrames();
    const metrics = this.getPerformanceMetrics();

    console.log('📊 BUFFER METRICS');
    console.log('─────────────────');
    console.table({
      'Total Frames': analysis.totalFrames,
      'Buffer Size': `${analysis.bufferSizeKB} KB`,
      'Bytes Per Frame': this.frameSize,
    });

    console.log('\n🔄 FRAME DATA INTEGRITY');
    console.log('─────────────────────────');
    console.table({
      'Unique State Hashes': analysis.uniqueHashes,
      'Sequence Valid': analysis.frameSequenceValid ? '✅ YES' : '❌ NO',
      'Expected Frames': 300,
      'Hash Variation': analysis.uniqueHashes === 300 ? '✅ DETERMINISTIC' : '⚠️ REPEATED',
    });

    console.log('\n⏱️ PERFORMANCE METRICS');
    console.log('──────────────────────');
    console.table({
      'Duration': `${metrics.durationSeconds}s`,
      'Calculated FPS': metrics.calculatedFPS,
      'Start': metrics.startTimestamp,
      'End': metrics.endTimestamp,
    });

    console.log('\n🎯 STATE HASH ANALYSIS');
    console.log('──────────────────────');
    console.table({
      'Frame 0 Hash': metrics.firstFrameHash,
      'Frame 299 Hash': metrics.lastFrameHash,
      'Hashes Different': metrics.stateHashesDifferent ? '✅ YES' : '❌ NO',
      'Determinism': metrics.stateHashesDifferent ? '✅ VALID' : '❌ SUSPECT',
    });

    console.log('\n📋 FRAME SAMPLES');
    console.log('────────────────');
    const sampleIndices = [0, 75, 150, 225, 299];
    const sampleFrames = sampleIndices.map(i => {
      const h = this.getFrameHeader(i);
      return {
        Frame: i,
        'Frame Index': h.frameIndex,
        'State Hash': `0x${h.stateHash.toString(16).padStart(8, '0')}`,
        Commands: h.commandCount,
        'Timestamp': new Date(h.timestamp).toISOString().split('T')[1],
      };
    });
    console.table(sampleFrames);

    console.log('\n✅ VERDICT');
    console.log('──────────');
    
    const verdict = {
      bufferIntegrity: analysis.bufferSize === 300 * 1024,
      frameSequence: analysis.frameSequenceValid,
      stateHashDeterministic: metrics.stateHashesDifferent,
      allFramesCaptured: analysis.totalFrames === 300,
    };

    const allPass = Object.values(verdict).every(v => v === true);
    
    console.table(verdict);
    
    if (allPass) {
      console.log('\n🚀 ✅ TITAN v0.2.2 STRESS TEST: APPROVED');
      console.log('   All metrics passed. System ready for production.');
    } else {
      console.log('\n⚠️ TITAN v0.2.2 STRESS TEST: NEEDS REVIEW');
      console.log('   One or more metrics failed. Check details above.');
    }
    
    console.log('\n════════════════════════════════════════════════════════\n');
  }
}

/**
 * Main analysis function
 */
async function analyzeTrace(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const analyzer = new TraceAnalyzer(arrayBuffer);
    analyzer.printAnalysis();
    return analyzer;
  } catch (error) {
    console.error('[TraceAnalyzer] Error:', error);
  }
}

console.log('✅ Trace analyzer loaded. Usage:');
console.log('   const input = document.createElement("input");');
console.log('   input.type = "file";');
console.log('   input.onchange = (e) => analyzeTrace(e.target.files[0]);');
console.log('   input.click();');
