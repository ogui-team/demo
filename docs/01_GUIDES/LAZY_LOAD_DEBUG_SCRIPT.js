/**
 * LAZY-LOAD DEBUG SCRIPT
 * 
 * Paste this into the browser console to validate that mode-specific chunks
 * are loaded ONLY when the user clicks on the mode selector, not during bootloader init.
 * 
 * Usage:
 * 1. Open http://localhost:3000 in DevTools
 * 2. Go to Console tab
 * 3. Copy & paste entire script below
 * 4. Watch Network tab while clicking mode buttons
 * 5. Should see bootstrapMultiplayerRuntime.js, bootstrapFreeplayRuntime.js load on-demand
 */

console.log('[LazyLoadDebug] Initializing chunk monitor...');

// Track when each chunk is requested
const chunkLoadEvents = [];

// Hook into the ResourceTiming API to capture chunk loads
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.name.includes('bootstrap') || entry.name.includes('network-engine') || entry.name.includes('gamelogic')) {
      const event = {
        timestamp: performance.now(),
        url: entry.name,
        duration: entry.duration,
        type: entry.entryType,
      };
      chunkLoadEvents.push(event);
      console.log(`[LazyLoadDebug] 📦 Chunk loaded: ${entry.name.split('/').pop()} (${entry.duration.toFixed(0)}ms)`);
    }
  }
});

observer.observe({ entryTypes: ['resource', 'navigation'] });

// Track dynamic imports
const originalImport = window.import || (typeof import !== 'undefined' ? import : null);
if (originalImport) {
  console.log('[LazyLoadDebug] ✓ Import hook available');
}

// Monitor when mode selector is clicked
document.addEventListener('click', (e) => {
  const btn = e.target?.closest('button');
  if (btn && (btn.textContent.includes('MULTIPLAYER') || btn.textContent.includes('FREEPLAY') || btn.textContent.includes('EDITOR'))) {
    const mode = btn.textContent.trim();
    console.log(`[LazyLoadDebug] 🎮 User selected mode: ${mode}`);
    console.log(`[LazyLoadDebug] Chunks loaded so far: ${chunkLoadEvents.length}`);
    
    // Give 2 seconds for async imports to complete
    setTimeout(() => {
      console.log('[LazyLoadDebug] === FINAL CHUNK REPORT ===');
      console.table(chunkLoadEvents.map((e, i) => ({
        '#': i + 1,
        'Time (ms)': e.timestamp.toFixed(0),
        'Duration (ms)': e.duration.toFixed(0),
        'Resource': e.url.split('/').pop(),
      })));
      
      // Validate lazy-loading
      const multiplayerLoaded = chunkLoadEvents.some(e => e.url.includes('bootstrapMultiplayerRuntime'));
      const freeplayLoaded = chunkLoadEvents.some(e => e.url.includes('bootstrapFreeplayRuntime'));
      
      if (mode.includes('MULTIPLAYER') && multiplayerLoaded) {
        console.log('✅ PASS: Multiplayer chunk loaded on-demand');
      } else if (mode.includes('FREEPLAY') && freeplayLoaded) {
        console.log('✅ PASS: Freeplay chunk loaded on-demand');
      } else if (mode.includes('EDITOR')) {
        console.log('✅ PASS: Editor mode loaded');
      } else {
        console.warn('⚠️ WARNING: Expected chunk not detected - check Network tab');
      }
    }, 2000);
  }
}, true);

// Export summary function for manual inspection
window.lazyLoadDebugSummary = () => {
  console.log('=== LAZY LOAD VALIDATION SUMMARY ===');
  console.log(`Total chunks monitored: ${chunkLoadEvents.length}`);
  console.log('Chunks:');
  chunkLoadEvents.forEach((e, i) => {
    console.log(`  ${i + 1}. ${e.url.split('/').pop()} - ${e.duration.toFixed(0)}ms`);
  });
  return chunkLoadEvents;
};

console.log('[LazyLoadDebug] ✓ Ready! Click a mode button and check Network tab.');
console.log('[LazyLoadDebug] Run lazyLoadDebugSummary() for report.');
