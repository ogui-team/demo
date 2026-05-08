// REFERENCE: Current Production webpack.config.js (P1 Optimizations Applied)
// Location: client/webpack.config.js
// Status: ✅ Active | Ready for Phase 3 (Dynamic Imports)

const path = require('path');
const HtmlPlugin = require('html-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const SpeedMeasurePlugin = require('speed-measure-webpack-plugin');

const smp = new SpeedMeasurePlugin();

module.exports = (_env, argv = {}) => {
  const isProduction = argv.mode === 'production';
  const analyzeBundle = process.env.ANALYZE_BUNDLE === 'true';

  const config = {
    cache: {
      type: 'filesystem',
      cacheDirectory: path.resolve(__dirname, '.webpack_cache'),
      buildDependencies: {
        config: [__filename],
      },
    },
    entry: {
      bundle: './src/index.ts',
      // TODO Phase 3: Add bootloader entry
      // bootloader: './src/bootloader.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      chunkFilename: '[name].bundle.js',
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: {
            loader: 'ts-loader',
            options: {
              configFile: path.resolve(__dirname, 'tsconfig.json'),
              // P0 Optimization: Skip type checking in dev builds
              transpileOnly: !isProduction,
              compilerOptions: {
                sourceMap: !isProduction,
              },
            },
          },
          exclude: /node_modules/,
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
      alias: {
        '@engine': path.resolve(__dirname, './src/engine'),
        '@engine/core': path.resolve(__dirname, './src/engine/core'),
        '@engine/0-foundation': path.resolve(__dirname, './src/engine/0-foundation'),
        '@engine/1-kernel': path.resolve(__dirname, './src/engine/1-kernel'),
        '@engine/2-systems': path.resolve(__dirname, './src/engine/2-systems'),
        '@engine/3-network': path.resolve(__dirname, './src/engine/3-network'),
        '@engine/4-runtime': path.resolve(__dirname, './src/engine/4-runtime'),
      },
    },
    plugins: [
      new HtmlPlugin({
        template: './src/index.html',
        minify: {
          removeComments: false,
        },
      }),
      // P1 Optimization: Bundle analysis (run with: ANALYZE_BUNDLE=true npm run build)
      analyzeBundle && isProduction && new BundleAnalyzerPlugin({
        analyzerMode: 'static',
        reportFilename: 'bundle-report.html',
        openAnalyzer: false,
        generateStatsFile: true,
        statsFilename: 'bundle-stats.json',
        logLevel: 'info',
      }),
    ].filter(Boolean),
    optimization: isProduction
      ? {
          chunkIds: 'deterministic',
          // P1 Optimization: Extract webpack runtime into separate chunk
          runtimeChunk: 'single',
          splitChunks: {
            chunks: 'all',
            minSize: 20000,
            maxAsyncRequests: 30,
            maxInitialRequests: 30,
            automaticNameDelimiter: '-',
            cacheGroups: {
              // ============= VENDOR DEPENDENCIES =============
              // Three.js (37% of bundle) - highest priority
              // Static dependency, rarely changes
              // Cache: Long-term (1 year in production)
              threeVendor: {
                test: /[\\/]node_modules[\\/]three[\\/]/,
                name: 'three-vendor',
                priority: 50,
                enforce: true,
                reuseExistingChunk: true,
              },

              // All other npm packages
              vendor: {
                test: /[\\/]node_modules[\\/]/,
                name: 'vendor',
                priority: 30,
                enforce: true,
                reuseExistingChunk: true,
              },

              // ============= ENGINE SUBSYSTEMS =============
              // Network subsystem (3-network) - distinct concern
              // Contains MultiplayerClient, NetworkSyncSystem, etc.
              // Lazy-load candidate: Load only when multiplayer starts
              // Cache: Medium-term (30 days in production)
              networkEngine: {
                test: /[\\/]src[\\/]engine[\\/]3-network[\\/]/,
                name: 'network-engine',
                priority: 45,
                minSize: 0,
                reuseExistingChunk: true,
              },

              // Physics/Kernel core (1-kernel, 0-foundation)
              // Performance critical: Position, velocity, transforms
              // Must load before rendering starts
              // Cache: Long-term (1 year in production)
              physicsCore: {
                test: /[\\/]src[\\/]engine[\\/](1-kernel|0-foundation)[\\/]/,
                name: 'physics-core',
                priority: 42,
                minSize: 0,
                reuseExistingChunk: true,
              },

              // Runtime systems (2-systems, 4-runtime)
              // Animation, physics, collision, rendering
              // Updates frequently, but not as often as app code
              // Cache: Medium-term (30 days in production)
              runtimeSystems: {
                test: /[\\/]src[\\/]engine[\\/](2-systems|4-runtime)[\\/]/,
                name: 'runtime-systems',
                priority: 40,
                minSize: 0,
                reuseExistingChunk: true,
              },

              // Core engine utilities
              // Scene graph, entity registry, transform utils
              // Cache: Medium-term (30 days in production)
              engineCore: {
                test: /[\\/]src[\\/]engine[\\/]core[\\/]/,
                name: 'engine-core',
                priority: 38,
                minSize: 0,
                reuseExistingChunk: true,
              },

              // Game-specific systems
              // Game logic, game modes, world objects
              // Lazy-load candidate: Load when game mode starts
              // Cache: Short-term (1 day in production)
              gameLogic: {
                test: /[\\/]src[\\/](games|engine[\\/]game)[\\/]/,
                name: 'game-logic',
                priority: 35,
                minSize: 0,
                reuseExistingChunk: true,
              },

              // UI and diagnostics
              // Menus, HUD, debug panels
              // Lazy-load candidate: Load when UI first needed
              // Cache: Short-term (1 day in production)
              ui: {
                test: /[\\/]src[\\/]engine[\\/](ui|diagnostics)[\\/]/,
                name: 'ui-diagnostics',
                priority: 25,
                minSize: 0,
                reuseExistingChunk: true,
              },

              // Default for remaining app code
              appCommon: {
                minSize: 20000,
                priority: 10,
                reuseExistingChunk: true,
                name: 'app-common',
              },
            },
          },
        }
      : undefined,
    performance: isProduction
      ? {
          hints: 'warning',
          maxAssetSize: 1200000,
          maxEntrypointSize: 1220000,
          assetFilter: (assetFilename) => !assetFilename.endsWith('.map'),
        }
      : false,
    devServer: {
      port: 3000,
      hot: true,
      compress: true,
      historyApiFallback: true,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    mode: isProduction ? 'production' : 'development',
    // P0 Optimization: Source maps only in dev
    devtool: isProduction ? false : 'source-map',
  };

  // P1 Optimization: Wrap with SpeedMeasurePlugin when analyzing
  // Usage: MEASURE_SPEED=true npm run build
  if (process.env.MEASURE_SPEED === 'true' && isProduction) {
    return smp.wrap(config);
  }
  return config;
};

/*
=============================================================================
USAGE GUIDE
=============================================================================

1. Normal Build:
   npm run build                    # Production (optimized)
   npm run build -- --mode dev      # Development (with source maps)

2. Analyze Bundle:
   ANALYZE_BUNDLE=true npm run build
   # Opens dist/bundle-report.html in browser (visual breakdown)

3. Measure Build Speed:
   MEASURE_SPEED=true npm run build
   # SpeedMeasure plugin logs per-loader timing

4. Check Cache Status:
   npm run build                    # First: ~85s (cold cache)
   npm run build                    # Second: ~20s (warm cache, cached chunks)

=============================================================================
CHUNK BREAKDOWN (Current Production Build)
=============================================================================

Entrypoint: 1.53 MiB = runtime.js + three-vendor.js + engine-core.js + 
                       ui-diagnostics.js + app-common.js + bundle.js

Chunks by Size:
  app-common.js (721 KiB)         - Main app code (kernel, network, systems)
  three-vendor.js (561 KiB)       - Three.js library
  ui-diagnostics.js (198 KiB)     - UI + debug panels
  engine-core.js (120 KiB)        - Core utilities
  runtime.js (1.01 KiB)           - Webpack bootstrap
  bundle.js (152 bytes)           - Entry point

Phase 3 Plan (On-Demand):
  Critical Path (Upfront): 850 KiB
    - runtime.js (1 KiB)
    - bootloader.js (150 KiB est.) ← NEW
    - three-vendor.js (561 KiB)
    - physics-core.js (50 KiB est.)
    - engine-core.js (120 KiB)

  Deferred (Lazy-Load): 600 KiB
    - network-engine.js (100 KiB est.) ← ON DEMAND
    - ui-diagnostics.js (198 KiB) ← ON DEMAND
    - game-logic.js (50 KiB est.) ← ON DEMAND
    - runtime-systems.js (100 KiB est.) ← ON DEMAND

Expected TTI Improvement: 800ms → 350ms (56% faster)

=============================================================================
CACHE STRATEGY
=============================================================================

Filesystem Cache (Webpack):
  - Already enabled: .webpack_cache/
  - Content-based hashing: automatic invalidation on file changes
  - Chunk isolation: changing app code doesn't rebuild three-vendor.js
  - Expected rebuild time (warm cache, app code only): ~20s

HTTP Cache Headers (For Production Deployment):
  # See P1_SUMMARY.md for nginx configuration
  # Long-term cache for vendors (1 year)
  # Medium-term cache for subsystems (30 days)
  # Short-term cache for app code (1 hour)

Result:
  - Cold visit: 850 KiB download → 350ms TTI
  - Repeat visit: 0 KiB download (cached) → 100ms TTI (local cache hit)

=============================================================================
NEXT STEPS (Phase 3)
=============================================================================

1. Create src/bootloader.ts (minimal entry point)
2. Create src/engine/runtime/bootstrapMinimalRuntime.ts
3. Update entry points in this config
4. Update src/index.html to load bootloader first
5. Add dynamic imports for game modes
6. Measure and validate TTI improvement

See: P1_ONDEMAND_ARCHITECTURE.md for detailed implementation guide

=============================================================================
*/
