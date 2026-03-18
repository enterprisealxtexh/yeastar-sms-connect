const util = require('util');
const fs = require('fs');

// Simple logger with level control. Default level: 'error'
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const envLevel = (process.env.LOCAL_AGENT_LOG_LEVEL || 'error').toLowerCase();
const CURRENT_LEVEL = LEVELS[envLevel] !== undefined ? LEVELS[envLevel] : LEVELS.error;

const ERROR_LOG = process.env.ERROR_LOG_PATH || '/tmp/local-api-errors.log';

function writeErrorToFile(message) {
  try {
    fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] ${message}\n`);
  } catch (e) {
    // ignore
  }
}

module.exports = {
  error: (msg, ...args) => {
    const out = typeof msg === 'string' ? util.format(msg, ...args) : util.inspect(msg);
    console.error(out);
    writeErrorToFile(out);
  },
  warn: (msg, ...args) => {
    if (CURRENT_LEVEL >= LEVELS.warn) {
      const out = typeof msg === 'string' ? util.format(msg, ...args) : util.inspect(msg);
      console.warn(out);
    }
  },
  info: (msg, ...args) => {
    if (CURRENT_LEVEL >= LEVELS.info) {
      const out = typeof msg === 'string' ? util.format(msg, ...args) : util.inspect(msg);
      console.log(out);
    }
  },
  debug: (msg, ...args) => {
    if (CURRENT_LEVEL >= LEVELS.debug) {
      const out = typeof msg === 'string' ? util.format(msg, ...args) : util.inspect(msg);
      console.debug(out);
    }
  }
};
