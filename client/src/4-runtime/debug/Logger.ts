/**
 * Logger - Global verbose logging utility
 * 
 * Browser API:
 *   ENGINE_VERBOSE(true/false)  - Toggle verbose mode
 *   window.ENGINE_LOGGER        - Direct access to logger
 */

export const Logger = {
  verbose: false, // Kannst du im Browser auf true setzen
  log(system: string, message: string, data?: any) {
    if (!this.verbose) return;
    console.log(
      `%c[${system}] %c${message}`,
      "color: #00ff00; font-weight: bold",
      "color: #fff",
      data || ""
    );
  },

  warn(system: string, message: string, data?: any) {
    if (!this.verbose) return;
    console.warn(
      `%c[${system}] %c${message}`,
      "color: #ffaa00; font-weight: bold",
      "color: #fff",
      data || ""
    );
  },

  error(system: string, message: string, data?: any) {
    console.error(
      `%c[${system}] %c${message}`,
      "color: #ff4444; font-weight: bold",
      "color: #fff",
      data || ""
    );
  },

  lifecycle(phase: string, data?: any) {
    console.log(
      `%cLIFECYCLE: %c${phase}`,
      "color: #0099ff; font-weight: bold; font-size: 12px",
      "color: #00ff00; font-size: 12px",
      data ? `(${JSON.stringify(data)})` : ""
    );
  },
};

// Global verfügbar machen
(window as any).ENGINE_VERBOSE = (val: boolean) => {
  Logger.verbose = val;
  console.log(`[Logger] Verbose mode: ${val}`);
};

(window as any).ENGINE_LOGGER = Logger;
