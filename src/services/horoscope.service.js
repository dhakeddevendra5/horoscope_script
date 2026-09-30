import { ZODIAC_SIGNS, SIGN_META, SIGN_PERSONALITY, TIME_WINDOWS, NUMBER_WORDS } from "../config/constants.js";
import env from "../config/env.js";
import { writeLog, writeFailureLog } from "../utils/logger.js";
import { generateAIResponse } from "./ai/ai.service.js";
import { buildHoroscopePrompt } from "../utils/prompt.js";
import { runQA } from "../utils/qa.js";
import { seededPick, makeSeed } from "../utils/helpers.js";
import Horoscope from "../models/horoscope.model.js";

let cancelFlag = false;

export function stopGeneration() {
    cancelFlag = true;
}

// ==================== SECTION FIELDS ====================

const SECTION_FIELDS = [
    "emotion", "profession", "career", "love",
    "family", "health", "moneyAndFinance", "travel",
];

// ==================== JSON EXTRACTION ====================

function extractJSON(rawResponse) {
    if (!rawResponse || typeof rawResponse !== "string") return null;

    let cleaned = rawResponse
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

    const start = cleaned.indexOf("{");
    if (start !== -1) {
        let depth = 0;
        let inStr = false;
        let escape = false;
        for (let i = start; i < cleaned.length; i++) {
            const ch = cleaned[i];
            if (escape) { escape = false; continue; }
            if (ch === "\\") { escape = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === "{") depth++;
            else if (ch === "}") {
                depth--;
                if (depth === 0) {
                    try {
                        const obj = JSON.parse(cleaned.slice(start, i + 1));
                        obj.source = "production";
                        return obj;
                    } catch { break; }
                }
            }
        }
    }

    const s2 = cleaned.indexOf("{");
    const e2 = cleaned.lastIndexOf("}");
    if (s2 !== -1 && e2 > s2) {
        try {
            const fixed = cleaned
                .slice(s2, e2 + 1)
                .replace(/,\s*([}\]])/g, "$1");
            const obj = JSON.parse(fixed);
            obj.source = "production";
            return obj;
        } catch { /* fall through */ }
    }

    return null;
}

// ==================== SECTION FALLBACK BUILDER ====================

function buildSectionFallback(field, sign) {
    const cap = field.charAt(0).toUpperCase() + field.slice(1);
    return {
        title: `${sign} ${cap} Today`,
        content: `Your ${field} outlook is constructive today. Channel your energy with intention and stay consistent with your goals.`,
        level: "normal",
        dashaTitle: `Planetary Influence on ${sign} ${cap}`,
        dashaContent: `The current dasha period supports ${sign} in the area of ${field}. Planetary alignments encourage steady progress and mindful decisions.`,
        toDo: [
            `Take one focused action in your ${field} area today.`,
            `Review your ${field} priorities before midday.`,
            `Communicate clearly with anyone involved in your ${field} matters.`,
        ],
        toAvoid: [
            `Avoid making impulsive ${field} decisions without reflection.`,
            `Do not ignore signals that require your attention in this area.`,
            `Avoid comparing your ${field} situation to others today.`,
        ],
        experience: [
            `You notice increased clarity around your ${field} situation.`,
            `A sense of forward momentum builds steadily through the day.`,
            `You find small but meaningful progress in your ${field} life.`,
        ],
    };
}

// ==================== NORMALIZE ====================

function normalizeHoroscope(obj, sign, targetDate) {
    if (!obj || typeof obj !== "object") return obj;

    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const meta = SIGN_META[sign];
    const p = SIGN_PERSONALITY[sign];

    obj.zodiacSign = sign;
    obj.type = "daily";
    obj.day = targetDate.getDate();
    obj.month = targetDate.getMonth() + 1;
    obj.year = targetDate.getFullYear();
    obj.weekday = weekdays[targetDate.getDay()];
    obj.signRuler = obj.signRuler || meta.ruler;
    obj.element = obj.element || meta.element;
    obj.luckyDay = obj.luckyDay || "Wednesday";
    obj.source = "production";

    const ratingFields = [
        "overallRating", "physicalRating", "emotionalRating",
        "intellectualRating", "spiritualRating",
    ];
    const defaults = ["3.8", "3.5", "3.6", "3.7", "3.4"];
    ratingFields.forEach((f, i) => {
        if (!obj[f] || obj[f] === "") obj[f] = defaults[i];
    });

    if (!obj.compatibilitySign) {
        obj.compatibilitySign = seededPick(meta.compatibility, makeSeed(sign, targetDate, 1));
    }

    if (!obj.bestTimeToday) obj.bestTimeToday = seededPick(TIME_WINDOWS.afternoon, makeSeed(sign, targetDate, 10));
    if (!obj.avoidTime) obj.avoidTime = seededPick(TIME_WINDOWS.noon, makeSeed(sign, targetDate, 60));

    if (typeof obj.luckyNumber === "number" || typeof obj.luckyNumber === "string") {
        const n = parseInt(obj.luckyNumber, 10);
        const safe = (n >= 1 && n <= 9) ? n : 7;
        obj.luckyNumber = { numeric: safe, string: NUMBER_WORDS[safe] };
    } else if (!obj.luckyNumber || typeof obj.luckyNumber !== "object") {
        const n = (makeSeed(sign, targetDate, 5) % 9) + 1;
        obj.luckyNumber = { numeric: n, string: NUMBER_WORDS[n] };
    } else {
        const n = parseInt(obj.luckyNumber.numeric, 10);
        const safe = (Number.isInteger(n) && n >= 1 && n <= 9) ? n : 7;
        obj.luckyNumber.numeric = safe;
        obj.luckyNumber.string = obj.luckyNumber.string || NUMBER_WORDS[safe];
    }

    if (typeof obj.luckyColor === "string") {
        const hex = /^#[0-9A-Fa-f]{6}$/.test(obj.luckyColor) ? obj.luckyColor : "#C94B2A";
        obj.luckyColor = { hexCode: hex, colorName: "Warm Amber" };
    } else if (!obj.luckyColor || typeof obj.luckyColor !== "object") {
        obj.luckyColor = { hexCode: "#C94B2A", colorName: "Warm Amber" };
    } else {
        if (!/^#[0-9A-Fa-f]{6}$/.test(obj.luckyColor.hexCode || ""))
            obj.luckyColor.hexCode = "#C94B2A";
        if (!obj.luckyColor.colorName) obj.luckyColor.colorName = "Warm Amber";
    }

    if (!obj.snippet || obj.snippet.trim() === "")
        obj.snippet = `${sign} Horoscope Today: Your work energy is strong — use it deliberately. Relationships deepen through honest conversation. Financial patience outperforms quick decisions.`;

    if (!obj.keyAdvice || obj.keyAdvice.trim() === "")
        obj.keyAdvice = `Direct your strongest energy toward your most important task today.`;

    if (!obj.mainContent || obj.mainContent.trim() === "")
        obj.mainContent = `${p.uniquePhrase} Today carries focused energy for ${sign}. Your core nature — ${p.coreNature} — is both compass and challenge in equal measure. The time window around ${obj.bestTimeToday} is your clearest window for decisive action. Bring full attention to what matters most, and set aside what can wait. ${p.uniquePhrase}`;

    if (!obj.todaySolution || obj.todaySolution.trim() === "")
        obj.todaySolution = `Wear ${obj.luckyColor.colorName} today to align with your planetary energy. Face east during your morning routine to receive maximum solar benefit. Repeat "Om Namah Shivaya" seven times before beginning work. Choose warm, light foods over heavy meals. Avoid cold drinks until after noon. Give your ${p.bodyZone} gentle attention — a short stretch or self-massage in the evening supports recovery.`;

    for (const field of SECTION_FIELDS) {
        const fallback = buildSectionFallback(field, sign);
        const val = obj[field];

        if (typeof val === "string") {
            const content = val.trim() || fallback.content;
            obj[field] = { ...fallback, content };
        } else if (val && typeof val === "object") {
            if (!val.title || val.title.trim() === "") val.title = fallback.title;
            if (!val.content || val.content.trim() === "") val.content = fallback.content;
            if (!val.dashaTitle || val.dashaTitle.trim() === "") val.dashaTitle = fallback.dashaTitle;
            if (!val.dashaContent || val.dashaContent.trim() === "") val.dashaContent = fallback.dashaContent;

            const validLevels = ["neutral", "challenging", "normal"];
            if (!validLevels.includes(val.level)) val.level = "normal";

            for (const arrKey of ["toDo", "toAvoid", "experience"]) {
                if (!Array.isArray(val[arrKey])) {
                    val[arrKey] = fallback[arrKey];
                } else {
                    val[arrKey] = val[arrKey].filter((item) => typeof item === "string" && item.trim() !== "");
                    while (val[arrKey].length < 3) {
                        val[arrKey].push(fallback[arrKey][val[arrKey].length % 3]);
                    }
                }
            }
        } else {
            obj[field] = { ...fallback };
        }
    }

    return obj;
}

// ==================== VALIDATION ====================

function validateSection(section, fieldKey) {
    if (!section || typeof section !== "object") return `"${fieldKey}" is not an object`;
    for (const key of ["title", "content", "level", "dashaTitle", "dashaContent"]) {
        if (typeof section[key] !== "string" || section[key].trim() === "")
            return `"${fieldKey}.${key}" missing or empty`;
    }
    const validLevels = ["neutral", "challenging", "normal"];
    if (!validLevels.includes(section.level))
        return `"${fieldKey}.level" invalid: "${section.level}"`;
    for (const key of ["toDo", "toAvoid", "experience"]) {
        if (!Array.isArray(section[key]) || section[key].length < 3)
            return `"${fieldKey}.${key}" needs at least 3 items`;
        for (let i = 0; i < section[key].length; i++) {
            if (typeof section[key][i] !== "string" || section[key][i].trim() === "")
                return `"${fieldKey}.${key}[${i}]" is empty`;
        }
    }
    return null;
}

function validateHoroscope(obj, sign, targetDate) {
    if (!obj || typeof obj !== "object") return "not a JSON object";

    for (const key of [
        "zodiacSign", "type", "weekday", "signRuler", "element", "luckyDay",
        "overallRating", "physicalRating", "emotionalRating", "intellectualRating",
        "spiritualRating", "compatibilitySign", "mainContent", "todaySolution",
        "snippet", "keyAdvice", "bestTimeToday", "avoidTime",
    ]) {
        if (!obj[key] || (typeof obj[key] === "string" && obj[key].trim() === ""))
            return `missing field: "${key}"`;
    }

    if (obj.zodiacSign !== sign) return `zodiacSign mismatch`;
    if (obj.type !== "daily") return `type must be "daily"`;
    if (obj.day !== targetDate.getDate()) return `day mismatch`;
    if (obj.month !== targetDate.getMonth() + 1) return `month mismatch`;
    if (obj.year !== targetDate.getFullYear()) return `year mismatch`;

    if (!obj.luckyNumber || typeof obj.luckyNumber !== "object") return `luckyNumber must be object`;
    if (!Number.isInteger(obj.luckyNumber.numeric) || obj.luckyNumber.numeric < 1 || obj.luckyNumber.numeric > 9)
        return `luckyNumber.numeric must be int 1-9`;
    if (!obj.luckyNumber.string) return `luckyNumber.string missing`;

    if (!obj.luckyColor || typeof obj.luckyColor !== "object") return `luckyColor must be object`;
    if (!/^#[0-9A-Fa-f]{6}$/.test(obj.luckyColor.hexCode || "")) return `luckyColor.hexCode invalid`;
    if (!obj.luckyColor.colorName) return `luckyColor.colorName missing`;

    for (const field of SECTION_FIELDS) {
        const reason = validateSection(obj[field], field);
        if (reason) return reason;
    }
    return null;
}

// ==================== SINGLE SIGN GENERATOR ====================

async function generateHoroscope(sign, targetDate, index, total) {
    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, "0");
    const d = String(targetDate.getDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${d}`;

    console.log(`  [${index}/${total}] 🔮 Generating ${sign} for ${dateStr}...`);
    writeLog(dateStr, "INFO", `Generating ${sign} for ${dateStr} [${index}/${total}]`);

    const prompt = buildHoroscopePrompt(sign, targetDate);
    const retryNote = `\n\nIMPORTANT: Output ONLY a valid JSON object. Start with { and end with }. No markdown, no explanation, no extra text outside the JSON.`;

    for (let attempt = 1; attempt <= 2; attempt++) {
        const raw = await generateAIResponse(attempt === 1 ? prompt : prompt + retryNote);
        let obj = extractJSON(raw);

        if (!obj) {
            writeLog(dateStr, "WARN", `${sign} attempt ${attempt}: no JSON found in response`);
            if (attempt === 1) { console.log(`  [${index}/${total}] ⚠  ${sign} — no JSON, retrying`); }
            continue;
        }

        obj = normalizeHoroscope(obj, sign, targetDate);
        const reason = validateHoroscope(obj, sign, targetDate);

        if (reason) {
            writeLog(dateStr, "WARN", `${sign} attempt ${attempt} still invalid after normalize: ${reason}`);
            if (attempt === 1) { console.log(`  [${index}/${total}] ⚠  ${sign} — retrying (${reason})`); }
            continue;
        }

        const { clean, leakReason, topicWarning } = runQA(obj, sign, targetDate);
        if (leakReason) {
            writeLog(dateStr, "WARN", `${sign} attempt ${attempt} QA failed: ${leakReason}`);
            if (attempt === 1) { console.log(`  [${index}/${total}] ⚠  ${sign} — QA failed, retrying`); }
            continue;
        }

        if (topicWarning) writeLog(dateStr, "WARN", `TOPIC DRIFT ${sign} ${dateStr}: ${topicWarning}`);
        console.log(`  [${index}/${total}] ✅ ${sign} — done${attempt === 2 ? " (retry)" : ""}`);
        writeLog(dateStr, "INFO", `SUCCESS${attempt === 2 ? " (retry)" : ""}: ${sign} for ${dateStr}`);
        return clean;
    }

    writeLog(dateStr, "WARN", `${sign} LLM output unusable — using normalized fallback object`);
    console.log(`  [${index}/${total}] ⚠  ${sign} — model output unusable, using fallback`);

    const fallback = normalizeHoroscope({ zodiacSign: sign }, sign, targetDate);
    const finalCheck = validateHoroscope(fallback, sign, targetDate);
    if (finalCheck) {
        writeLog(dateStr, "ERROR", `FAILED: ${sign} ${dateStr} — fallback invalid: ${finalCheck}`);
        writeFailureLog(targetDate, sign, finalCheck);
        throw new Error(`Failed to generate horoscope for ${sign} on ${dateStr}`);
    }
    return fallback;
}

// ==================== BATCH SAVE TO MONGODB ====================

async function saveHoroscopesForDate(batchResults, targetDate) {
    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, "0");
    const d = String(targetDate.getDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${d}`;

    const newSignData = batchResults.filter((r) => r.success).map((r) => r.data);
    let savedCount = 0;
    
    for (const data of newSignData) {
        try {
            await Horoscope.findOneAndUpdate(
                { 
                    zodiacSign: data.zodiacSign, 
                    day: data.day, 
                    month: data.month, 
                    year: data.year 
                },
                { $set: data },
                { upsert: true, returnDocument: 'after' }
            );
            savedCount++;
        } catch (error) {
            writeLog(dateStr, "ERROR", `Failed to save ${data.zodiacSign} to DB: ${error.message}`);
            console.error(`  ❌ DB Save Failed for ${data.zodiacSign}: ${error.message}`);
        }
    }

    writeLog(dateStr, "INFO", `Batch saved to DB (${savedCount} signs)`);
    console.log(`  💾 Batch saved to DB (${savedCount} signs)`);
    return savedCount;
}

// ==================== DATE RUNNER ====================

async function generateForDate(targetDate) {
    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, "0");
    const d = String(targetDate.getDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${d}`;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const label = targetDate < today ? "PAST" : targetDate > today ? "FUTURE" : "TODAY";

    console.log(`\n📅 Generating horoscopes for ${dateStr} (${label})`);
    console.log(`🎯 ${ZODIAC_SIGNS.length} signs to generate\n`);
    writeLog(dateStr, "INFO", `---- Starting ${dateStr} (${label}) ----`);

    let totalSuccess = 0, totalFailed = 0;
    const errors = [];
    
    // Reset flag if this is a single date run, but date range might have already set it false.
    // For safety, we only break if it's true.
    for (let i = 0; i < ZODIAC_SIGNS.length; i += env.CONCURRENT_LIMIT) {
        if (cancelFlag) {
            console.log("🛑 Generation aborted by user.");
            writeLog(dateStr, "INFO", "Generation aborted by user.");
            break;
        }

        const batchNum = Math.floor(i / env.CONCURRENT_LIMIT) + 1;
        const totalBatches = Math.ceil(ZODIAC_SIGNS.length / env.CONCURRENT_LIMIT);
        const batch = ZODIAC_SIGNS.slice(i, i + env.CONCURRENT_LIMIT);

        console.log(`\n  📦 Batch ${batchNum}/${totalBatches}: ${batch.join(", ")}`);
        writeLog(dateStr, "INFO", `Batch ${batchNum}/${totalBatches}: ${batch.join(", ")}`);

        const batchResults = await Promise.all(
            batch.map((sign, idx) =>
                generateHoroscope(sign, targetDate, i + idx + 1, ZODIAC_SIGNS.length)
                    .then((data) => ({ sign, success: true, data }))
                    .catch((err) => ({ sign, success: false, error: err.message }))
            )
        );

        for (const r of batchResults) {
            if (r.success) { totalSuccess++; }
            else {
                totalFailed++;
                errors.push({ sign: r.sign, error: r.error });
                console.log(`  ❌ ${r.sign} failed: ${r.error}`);
                writeLog(dateStr, "ERROR", `FAILED: ${r.sign} ${dateStr} — ${r.error}`);
                writeFailureLog(targetDate, r.sign, r.error);
            }
        }

        if (batchResults.length > 0 && batchResults.every(r => !r.success)) {
            console.log("🛑 All items in batch failed. Auto-aborting generation.");
            writeLog(dateStr, "ERROR", "All items in batch failed. Auto-aborting generation.");
            cancelFlag = true;
        }

        await saveHoroscopesForDate(batchResults, targetDate);
        writeLog(dateStr, "INFO", `Batch ${batchNum}/${totalBatches} done`);
        batchResults.length = 0;

        if (i + env.CONCURRENT_LIMIT < ZODIAC_SIGNS.length) {
            console.log(`\n  ⏳ Waiting 3 seconds...\n`);
            await new Promise((r) => setTimeout(r, 3000));
        }
    }

    writeLog(dateStr, "INFO", `Finished ${dateStr}: ${totalSuccess} ok, ${totalFailed} failed`);
    return { totalSuccess, errors, targetDate };
}

// ==================== MULTI-DAY RUNNERS ====================

async function generateForDateRange(startDate, endDate) {
    cancelFlag = false; // Reset on new run
    let currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
        if (cancelFlag) {
            console.log("🛑 Date range generation aborted by user.");
            break;
        }
        await generateForDate(new Date(currentDate));
        // Add 1 day
        currentDate.setDate(currentDate.getDate() + 1);
    }
}

async function generateForMonth(year, month) {
    cancelFlag = false; // Reset on new run
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // 0 gets the last day of the previous month (which is the current month here)
    
    await generateForDateRange(startDate, endDate);
}

export { generateHoroscope, generateForDate, saveHoroscopesForDate, generateForDateRange, generateForMonth, stopGeneration };
