const path = require('path');
const webpack = require('webpack');
const HtmlPlugin = require('html-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const SpeedMeasurePlugin = require('speed-measure-webpack-plugin');

const smp = new SpeedMeasurePlugin();

module.exports = (_env, argv = {}) => {
  const isProduction = argv.mode === 'production';
  const analyzeBundle = process.env.ANALYZE_BUNDLE === 'true';

  const config = {
    // Keep filesystem cache for production builds, but use in-memory cache in
    // dev to avoid stale managedPaths snapshots under Windows workspaces.
    cache: isProduction
      ? {
          type: 'filesystem',
          cacheDirectory: path.resolve(__dirname, '.webpack_cache'),
          buildDependencies: {
            config: [__filename],
          },
        }
      : {
          type: 'memory',
        },
    snapshot: {
      // Disable node_modules managed-path optimization to avoid false
      // "isn't a directory" warnings from FileSystemInfo on some setups.
      managedPaths: [],
    },
    entry: {
      bootloader: './src/bootloader.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      publicPath: '/',
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
        '@engine': path.resolve(__dirname, './src'),
        '@engine/0-foundation': path.resolve(__dirname, './src/0-foundation'),
        '@engine/1-kernel': path.resolve(__dirname, './src/1-kernel'),
        '@engine/2-systems': path.resolve(__dirname, './src/2-systems'),
        '@engine/3-network': path.resolve(__dirname, './src/3-network'),
        '@engine/4-runtime': path.resolve(__dirname, './src/4-runtime'),
        '@shared/contracts': path.resolve(__dirname, '../packages/shared-contracts/src/index.ts'),
      },
    },
    plugins: [
      new webpack.EnvironmentPlugin({
        SERVER_URL: '',
        SERVER_HTTP_URL: '',
        SERVER_WS_URL: '',
      }),
      new HtmlPlugin({
        template: './src/index.html',
        chunks: ['runtime', 'bootloader'],
        filename: 'index.html',
        minify: {
          removeComments: false,
        },
      }),
      // Bundle analysis (run with: ANALYZE_BUNDLE=true npm run build)
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
          runtimeChunk: 'single',  // Extract webpack runtime into separate chunk
          splitChunks: {
            chunks: 'all',
            minSize: 20000,
            maxAsyncRequests: 30,
            maxInitialRequests: 30,
            automaticNameDelimiter: '-',
            cacheGroups: {
              // ============= VENDOR =============
              // Three.js (37% of bundle) - highest priority
              threeVendor: {
                test: /[\\/]node_modules[\\/]three[\\/]/,
                name: 'three-vendor',
                priority: 50,
                enforce: true,
                reuseExistingChunk: true,
              },

              // All other vendors
              vendor: {
                test: /[\\/]node_modules[\\/]/,
                name: 'vendor',
                priority: 30,
                enforce: true,
                reuseExistingChunk: true,
              },

              // ============= ENGINE SUBSYSTEMS =============
              // Network subsystem (3-network) - distinct concern
              networkEngine: {
                test: /[\\/]src[\\/]3-network[\\/]/,
                name: 'network-engine',
                priority: 45,
                minSize: 0,
                reuseExistingChunk: true,
              },

              // Physics/Kernel core (1-kernel, 0-foundation) - performance critical
              physicsCore: {
                test: /[\\/]src[\\/](1-kernel|0-foundation)[\\/]/,
                name: 'physics-core',
                priority: 42,
                minSize: 0,
                reuseExistingChunk: true,
              },

              // Runtime systems (2-systems, 4-runtime) 
              runtimeSystems: {
                test: /[\\/]src[\\/](2-systems|4-runtime)[\\/]/,
                name: 'runtime-systems',
                priority: 40,
                minSize: 0,
                reuseExistingChunk: true,
              },

              // Core engine utilities
              engineCore: {
                test: /[\\/]src[\\/]1-kernel[\\/]core[\\/]/,
                name: 'engine-core',
                priority: 38,
                minSize: 0,
                reuseExistingChunk: true,
              },

              // Game-specific systems (can be lazy-loaded later)
              gameLogic: {
                test: /[\\/]src[\\/](games|2-systems[\\/]gameplay[\\/]game)[\\/]/,
                name: 'game-logic',
                priority: 35,
                minSize: 0,
                reuseExistingChunk: true,
              },

              // UI and diagnostics (lower priority)
              ui: {
                test: /[\\/]src[\\/]4-runtime[\\/](ui|diagnostics|editor|debug|audit)[\\/]/,
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
    devtool: isProduction ? false : 'source-map',
  };

  // Wrap with SpeedMeasurePlugin when analyzing (MEASURE_SPEED=true npm run build)
  if (process.env.MEASURE_SPEED === 'true' && isProduction) {
    return smp.wrap(config);
  }
  return config;
};
