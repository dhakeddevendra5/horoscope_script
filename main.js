#!/usr/bin/env node
/**
 * OpenClaw AI — Horoscope Generator entry point
 *
 * Responsibilities:
 *   • Parse CLI arguments / run interactive prompt
 *   • Apply runtime config overrides
 *   • Check Ollama connectivity
 *   • Dispatch single-date or date-range jobs
 *   • Print final summary
 */

"use strict";

const path = require("path");
const { CONFIG, ZODIAC_SIGNS } = require("./config");
const { LOG_DIR, LOG_FILE, FAILURE_LOG_FILE, ensureLogDir, writeLog } = require("./logger");
const { callOllama } = require("./ollama");
const { generateForDate } = require("./generator");

// ==================== DATE PARSER ====================

/**
 * Parse a human-readable date string into a Date object.
 * Accepts: YYYY-MM-DD | MM/DD/YYYY | today | tomorrow | yesterday
 *
 * @param {string} input
 * @returns {Date|null}
 */
function parseDate(input) {
    if (!input) return null;
    const s = input.trim();

    if (s.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const [year, month, day] = s.split("-").map(Number);
        return new Date(year, month - 1, day);
    }
    if (s.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
        const [month, day, year] = s.split("/").map(Number);
        return new Date(year, month - 1, day);
    }

    switch (s.toLowerCase()) {
        case "today": return new Date();
        case "tomorrow": { const t = new Date(); t.setDate(t.getDate() + 1); return t; }
        case "yesterday": { const y = new Date(); y.setDate(y.getDate() - 1); return y; }
        default: return null;
    }
}

// ==================== CLI ARGS ====================

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        date: null,
        endDate: null,
        model: CONFIG.model,
        outputDir: CONFIG.outputDir,
        concurrentLimit: CONFIG.concurrentLimit,
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--date":
            case "-d":
                config.date = parseDate(args[++i]);
                break;
            case "--range":
            case "-r":
                config.date = parseDate(args[++i]);
                config.endDate = parseDate(args[++i]);
                break;
            case "--model":
            case "-m":
                config.model = args[++i];
                break;
            case "--output":
            case "-o":
                config.outputDir = args[++i];
                break;
            case "--concurrent":
            case "-c":
                config.concurrentLimit = parseInt(args[++i], 10);
                break;
            case "--help":
            case "-h":
                showHelp();
                process.exit(0);
        }
    }

    return config;
}

function showHelp() {
    console.log(`
🔮 OpenClaw AI — Horoscope Generator

USAGE:
  node index.js [options]

OPTIONS:
  --date, -d <date>           Generate for a specific date
                              Formats: YYYY-MM-DD | MM/DD/YYYY | today | tomorrow | yesterday

  --range, -r <start> <end>   Generate for a date range (inclusive)
                              Example: --range 2026-05-16 2026-06-15

  --model, -m <model>         Ollama model  (default: ${CONFIG.model})
  --output, -o <dir>          Output directory  (default: ${CONFIG.outputDir})
  --concurrent, -c <n>        Concurrent sign generations per batch  (default: ${CONFIG.concurrentLimit})

LOGS (written to output directory):
  generator.log               Full timestamped activity log
  failures.log                One line per failed sign — date | sign | reason

EXAMPLES:
  node index.js --date today
  node index.js --date 2026-05-16
  node index.js --range 2026-05-16 2026-06-15
  node index.js                    # interactive mode
`);
}

// ==================== INTERACTIVE MODE ====================

async function interactivePrompt() {
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((res) => rl.question(q, res));

    console.log("\n🎯 OpenClaw AI Horoscope Generator");
    console.log("=".repeat(60));
    console.log("\n  1. Single date");
    console.log("  2. Date range");
    console.log("  3. 30 days from a start date");

    const choice = await ask("\nChoose (1-3): ");

    if (choice === "1") {
        const raw = await ask("Date (YYYY-MM-DD / today / tomorrow): ");
        const date = parseDate(raw);
        if (!date) { console.log("❌ Invalid date"); rl.close(); process.exit(1); }
        rl.close();
        return { type: "single", date };
    }

    if (choice === "2") {
        const startRaw = await ask("Start date (YYYY-MM-DD): ");
        const endRaw = await ask("End date   (YYYY-MM-DD): ");
        const start = parseDate(startRaw);
        const end = parseDate(endRaw);
        if (!start || !end) { console.log("❌ Invalid date(s)"); rl.close(); process.exit(1); }
        rl.close();
        return { type: "range", start, end };
    }

    if (choice === "3") {
        const startRaw = await ask("Start date (YYYY-MM-DD): ");
        const start = parseDate(startRaw);
        if (!start) { console.log("❌ Invalid date"); rl.close(); process.exit(1); }
        const end = new Date(start);
        end.setDate(end.getDate() + 29);   // 30 days inclusive
        rl.close();
        return { type: "range", start, end };
    }

    rl.close();
    return null;
}

// ==================== TASK ASSIGNER — DATE RANGE ====================

/**
 * Iterate over every date in [startDate, endDate] and dispatch each to
 * generateForDate(), collecting lightweight summaries.
 *
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<Array>}
 */
async function runDateRange(startDate, endDate) {
    const dates = [];
    const cur = new Date(startDate);
    while (cur <= endDate) {
        dates.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
    }

    console.log(`\n🌟 Generating horoscopes for ${dates.length} day(s) 🌟`);
    console.log(`📅 From : ${startDate.toDateString()}`);
    console.log(`📅 To   : ${endDate.toDateString()}`);
    console.log(`⏱️  Est. : ~${(dates.length * 2.5).toFixed(0)} minutes\n`);
    writeLog("INFO", `==== Range job started: ${dates.length} day(s) — ${startDate.toDateString()} → ${endDate.toDateString()} ====`);

    const allResults = [];

    for (let i = 0; i < dates.length; i++) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`📆 Day ${i + 1}/${dates.length}`);
        console.log(`${"=".repeat(60)}`);

        const { totalSuccess, errors } = await generateForDate(dates[i]);

        const y = dates[i].getFullYear();
        const m = String(dates[i].getMonth() + 1).padStart(2, "0");
        const d = String(dates[i].getDate()).padStart(2, "0");
        const fp = path.join(CONFIG.outputDir, `${y}-${m}-${d}.json`);

        console.log(`\n✅ Day complete: ${totalSuccess}/12 saved | ❌ Failed: ${errors.length}/12`);
        allResults.push({ date: dates[i], successful: totalSuccess, failed: errors.length, filepath: fp });

        if (i < dates.length - 1) {
            console.log(`\n⏳ Waiting 5 seconds before next day...`);
            await new Promise((r) => setTimeout(r, 5000));
        }
    }

    writeLog("INFO", `==== Range job complete ====`);
    return allResults;
}

// ==================== MAIN ====================

async function main() {
    console.log("\n" + "=".repeat(60));
    console.log("🔮 OpenClaw AI — Multi-Date Horoscope Generator 🔮");
    console.log("=".repeat(60));

    // ── Resolve job config ─────────────────────────────────────────────────
    let cfg = parseArgs();

    if (!cfg.date) {
        const interactive = await interactivePrompt();
        if (!interactive) { console.log("\n❌ No option selected."); process.exit(1); }

        if (interactive.type === "single") {
            cfg.date = interactive.date;
        } else {
            cfg.date = interactive.start;
            cfg.endDate = interactive.end;
        }
    }

    // ── Apply runtime overrides to shared CONFIG ───────────────────────────
    CONFIG.model = cfg.model;
    CONFIG.outputDir = cfg.outputDir;
    CONFIG.concurrentLimit = cfg.concurrentLimit;

    // ── Boot logging ───────────────────────────────────────────────────────
    ensureLogDir();
    writeLog("INFO", "=".repeat(50));
    writeLog("INFO", `Session started — Model: ${CONFIG.model} | Dir: ${CONFIG.outputDir} | Concurrency: ${CONFIG.concurrentLimit}`);

    // ── Connectivity check ─────────────────────────────────────────────────
    console.log("\n🔍 Checking Ollama connection...");
    try {
        await callOllama("test");
        console.log("✅ Ollama connected");
        writeLog("INFO", "Ollama connection: OK");
    } catch (err) {
        const msg = `Cannot connect to Ollama: ${err.message}`;
        console.error(`\n❌ ${msg}`);
        console.error("   Make sure Ollama is running: ollama serve");
        writeLog("ERROR", msg);
        process.exit(1);
    }

    console.log(`🤖 Model   : ${CONFIG.model}`);
    console.log(`📁 Output  : ${CONFIG.outputDir}`);
    console.log(`📂 Logs    : ${LOG_DIR}`);
    console.log(`📝 Log     : ${LOG_FILE}`);
    console.log(`⚠️  Failures: ${FAILURE_LOG_FILE}\n`);

    const startTime = Date.now();

    // ── Dispatch ───────────────────────────────────────────────────────────
    if (cfg.endDate) {
        // ── Date range ───────────────────────────────────────────────────────
        const results = await runDateRange(cfg.date, cfg.endDate);
        const totalDur = ((Date.now() - startTime) / 1000).toFixed(1);
        const totalSuccess = results.reduce((s, r) => s + r.successful, 0);
        const totalFailed = results.reduce((s, r) => s + r.failed, 0);

        console.log("\n" + "=".repeat(60));
        console.log("📊 COMPLETE SUMMARY");
        console.log("=".repeat(60));
        console.log(`📅 Days generated  : ${results.length}`);
        console.log(`✅ Total successes : ${totalSuccess}`);
        console.log(`❌ Total failures  : ${totalFailed}`);
        console.log(`⏱️  Total time      : ${totalDur} seconds`);
        console.log(`📁 Output dir      : ${path.resolve(CONFIG.outputDir)}`);
        console.log(`📝 Log             : ${path.resolve(LOG_FILE)}`);
        if (totalFailed > 0) {
            console.log(`⚠️  Failure log    : ${path.resolve(FAILURE_LOG_FILE)}`);
        }
        console.log("\n📄 Generated files:");
        results.forEach((r) => {
            const y = r.date.getFullYear();
            const m = String(r.date.getMonth() + 1).padStart(2, "0");
            const d = String(r.date.getDate()).padStart(2, "0");
            console.log(`   ${y}-${m}-${d}.json  (${r.successful}/12 signs)`);
        });

        writeLog("INFO", `Session complete — Days: ${results.length} | Success: ${totalSuccess} | Failed: ${totalFailed} | Duration: ${totalDur}s`);

    } else {
        // ── Single date ──────────────────────────────────────────────────────
        const { totalSuccess, errors, targetDate } = await generateForDate(cfg.date);
        const y = targetDate.getFullYear();
        const m = String(targetDate.getMonth() + 1).padStart(2, "0");
        const d = String(targetDate.getDate()).padStart(2, "0");
        const fp = path.join(CONFIG.outputDir, `${y}-${m}-${d}.json`);
        const dur = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log("\n" + "=".repeat(60));
        console.log("📊 GENERATION SUMMARY");
        console.log("=".repeat(60));
        console.log(`📅 Date       : ${targetDate.toDateString()}`);
        console.log(`✅ Successful : ${totalSuccess}/12 signs`);
        console.log(`❌ Failed     : ${errors.length}/12 signs`);
        console.log(`💾 Saved to   : ${path.resolve(fp)}`);
        console.log(`📝 Log        : ${path.resolve(LOG_FILE)}`);
        if (errors.length > 0) {
            console.log(`⚠️  Failures  : ${path.resolve(FAILURE_LOG_FILE)}`);
        }
        console.log(`⏱️  Time       : ${dur} seconds`);

        writeLog("INFO", `Session complete — Success: ${totalSuccess}/12 | Failed: ${errors.length}/12 | Duration: ${dur}s`);
    }

    console.log("\n✨ Done! ✨\n");
}

main().catch((err) => {
    writeLog("ERROR", `Fatal error: ${err.message}`);
    console.error("\n❌ Fatal error:", err.message);
    process.exit(1);
});