"use strict";

const fs = require("fs");
const path = require("path");
const { CONFIG } = require("./config");

// ==================== LOGGING SYSTEM ====================
// Two log files, both written inside CONFIG.outputDir:
//   generator.log  — full timestamped activity log for every run
//   failures.log   — one line per failed sign (date | sign | reason)

const LOG_DIR = path.join(CONFIG.outputDir, "logs");
const LOG_FILE = path.join(LOG_DIR, "generator.log");
const FAILURE_LOG_FILE = path.join(LOG_DIR, "failures.log");

/** Create the output directory and logs subfolder if they do not yet exist. */
function ensureLogDir() {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

/** Returns current time as "YYYY-MM-DD HH:MM:SS". */
function timestamp() {
    return new Date().toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Append one line to generator.log.
 * Also mirrors ERROR lines to stderr.
 *
 * @param {"INFO"|"WARN"|"ERROR"} level
 * @param {string} message
 */
function writeLog(level, message) {
    ensureLogDir();
    const line = `[${timestamp()}] [${level.padEnd(7)}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, line, "utf8");
    if (level === "ERROR") console.error(message);
}

/**
 * Append one line to failures.log.
 * Format: [TIMESTAMP] DATE=YYYY-MM-DD | SIGN=<sign> | REASON=<reason>
 *
 * @param {Date}   targetDate
 * @param {string} sign
 * @param {string} reason
 */
function writeFailureLog(targetDate, sign, reason) {
    ensureLogDir();
    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, "0");
    const d = String(targetDate.getDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${d}`;
    const line = `[${timestamp()}] DATE=${dateStr} | SIGN=${sign.padEnd(13)} | REASON=${reason}\n`;
    fs.appendFileSync(FAILURE_LOG_FILE, line, "utf8");
}

module.exports = {
    LOG_DIR,
    LOG_FILE,
    FAILURE_LOG_FILE,
    ensureLogDir,
    timestamp,
    writeLog,
    writeFailureLog,
};