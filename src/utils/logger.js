import Log from "../models/log.model.js";

async function writeLog(targetDateStr, level, message, meta = {}) {
    try {
        if (level === "ERROR") {
            console.error(`[${targetDateStr}] [${level}] ${message}`, meta);
        } else {
            console.log(`[${targetDateStr}] [${level}] ${message}`);
        }

        // Upsert the log for the day
        await Log.findOneAndUpdate(
            { targetDate: targetDateStr },
            { $push: { messages: { level, message, meta } } },
            { upsert: true, returnDocument: 'after' }
        );
    } catch (err) {
        console.error("Failed to write log to DB:", err.message);
    }
}

async function writeFailureLog(targetDate, sign, reason) {
    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, "0");
    const d = String(targetDate.getDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${d}`;
    
    await writeLog(dateStr, "ERROR", `Generation Failed: ${sign}`, { sign, reason });
}

export {
    writeLog,
    writeFailureLog,
};
