"use strict";

const fs = require("fs");
const path = require("path");
const { CONFIG, ZODIAC_SIGNS, SIGN_META, SIGN_PERSONALITY, TIME_WINDOWS, NUMBER_WORDS } = require("./config");
const { writeLog, writeFailureLog } = require("./logger");
const { callOllama } = require("./ollama");
const { buildHoroscopePrompt } = require("./prompt");
const { runQA } = require("./qa");

// ==================== SEEDED HELPERS ====================

function seededPick(arr, seed) {
    const s = (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
    return arr[s % arr.length];
}

function makeSeed(sign, targetDate, salt) {
    return (ZODIAC_SIGNS.indexOf(sign) * 7919 +
        targetDate.getDate() * 131 +
        (targetDate.getMonth() + 1) * 37 +
        (targetDate.getFullYear() % 100) * 17 +
        salt) >>> 0;
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

    // Strategy 1: brace-matching walk to find the outermost complete object
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

    // Strategy 2: try fixing common small-model mistakes then parse
    const s2 = cleaned.indexOf("{");
    const e2 = cleaned.lastIndexOf("}");
    if (s2 !== -1 && e2 > s2) {
        try {
            const fixed = cleaned
                .slice(s2, e2 + 1)
                .replace(/,\s*([}\]])/g, "$1");   // trailing commas
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

/**
 * Auto-correct common small-model output problems so the object
 * can pass validation without a full retry.
 */
function normalizeHoroscope(obj, sign, targetDate) {
    if (!obj || typeof obj !== "object") return obj;

    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const meta = SIGN_META[sign];
    const p = SIGN_PERSONALITY[sign];

    // ── Identity scalars ─────────────────────────────────────────────────────
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

    // ── Ratings ──────────────────────────────────────────────────────────────
    const ratingFields = [
        "overallRating", "physicalRating", "emotionalRating",
        "intellectualRating", "spiritualRating",
    ];
    const defaults = ["3.8", "3.5", "3.6", "3.7", "3.4"];
    ratingFields.forEach((f, i) => {
        if (!obj[f] || obj[f] === "") obj[f] = defaults[i];
    });

    // ── compatibilitySign ────────────────────────────────────────────────────
    if (!obj.compatibilitySign) {
        obj.compatibilitySign = seededPick(meta.compatibility, makeSeed(sign, targetDate, 1));
    }

    // ── Time windows ─────────────────────────────────────────────────────────
    if (!obj.bestTimeToday) obj.bestTimeToday = seededPick(TIME_WINDOWS.afternoon, makeSeed(sign, targetDate, 10));
    if (!obj.avoidTime) obj.avoidTime = seededPick(TIME_WINDOWS.noon, makeSeed(sign, targetDate, 60));

    // ── luckyNumber ──────────────────────────────────────────────────────────
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

    // ── luckyColor ───────────────────────────────────────────────────────────
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

    // ── Snippet / keyAdvice / mainContent / todaySolution ────────────────────
    if (!obj.snippet || obj.snippet.trim() === "")
        obj.snippet = `${sign} Horoscope Today: Your work energy is strong — use it deliberately. Relationships deepen through honest conversation. Financial patience outperforms quick decisions.`;

    if (!obj.keyAdvice || obj.keyAdvice.trim() === "")
        obj.keyAdvice = `Direct your strongest energy toward your most important task today.`;

    if (!obj.mainContent || obj.mainContent.trim() === "")
        obj.mainContent = `${p.uniquePhrase} Today carries focused energy for ${sign}. Your core nature — ${p.coreNature} — is both compass and challenge in equal measure. The time window around ${obj.bestTimeToday} is your clearest window for decisive action. Bring full attention to what matters most, and set aside what can wait. ${p.uniquePhrase}`;

    if (!obj.todaySolution || obj.todaySolution.trim() === "")
        obj.todaySolution = `Wear ${obj.luckyColor.colorName} today to align with your planetary energy. Face east during your morning routine to receive maximum solar benefit. Repeat "Om Namah Shivaya" seven times before beginning work. Choose warm, light foods over heavy meals. Avoid cold drinks until after noon. Give your ${p.bodyZone} gentle attention — a short stretch or self-massage in the evening supports recovery.`;

    // ── Section fields ───────────────────────────────────────────────────────
    for (const field of SECTION_FIELDS) {
        const fallback = buildSectionFallback(field, sign);
        const val = obj[field];

        if (typeof val === "string") {
            // Model returned flat text — wrap into object
            const content = val.trim() || fallback.content;
            obj[field] = { ...fallback, content };
        } else if (val && typeof val === "object") {
            // Object present — fill any missing/invalid keys
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
                    // Ensure at least 3 non-empty string items
                    val[arrKey] = val[arrKey]
                        .filter((item) => typeof item === "string" && item.trim() !== "");
                    while (val[arrKey].length < 3) {
                        val[arrKey].push(fallback[arrKey][val[arrKey].length % 3]);
                    }
                }
            }
        } else {
            // Missing entirely
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
    writeLog("INFO", `Generating ${sign} for ${dateStr} [${index}/${total}]`);

    const prompt = buildHoroscopePrompt(sign, targetDate);
    const retryNote = `\n\nIMPORTANT: Output ONLY a valid JSON object. Start with { and end with }. No markdown, no explanation, no extra text outside the JSON.`;

    for (let attempt = 1; attempt <= 2; attempt++) {
        const raw = await callOllama(attempt === 1 ? prompt : prompt + retryNote);
        let obj = extractJSON(raw);

        if (!obj) {
            writeLog("WARN", `${sign} attempt ${attempt}: no JSON found in response`);
            if (attempt === 1) { console.log(`  [${index}/${total}] ⚠  ${sign} — no JSON, retrying`); }
            continue;
        }

        // Auto-fix before validating
        obj = normalizeHoroscope(obj, sign, targetDate);
        const reason = validateHoroscope(obj, sign, targetDate);

        if (reason) {
            writeLog("WARN", `${sign} attempt ${attempt} still invalid after normalize: ${reason}`);
            if (attempt === 1) { console.log(`  [${index}/${total}] ⚠  ${sign} — retrying (${reason})`); }
            continue;
        }

        const { clean, leakReason, topicWarning } = runQA(obj, sign, targetDate);
        if (leakReason) {
            writeLog("WARN", `${sign} attempt ${attempt} QA failed: ${leakReason}`);
            if (attempt === 1) { console.log(`  [${index}/${total}] ⚠  ${sign} — QA failed, retrying`); }
            continue;
        }

        if (topicWarning) writeLog("WARN", `TOPIC DRIFT ${sign} ${dateStr}: ${topicWarning}`);
        console.log(`  [${index}/${total}] ✅ ${sign} — done${attempt === 2 ? " (retry)" : ""}`);
        writeLog("INFO", `SUCCESS${attempt === 2 ? " (retry)" : ""}: ${sign} for ${dateStr}`);
        return clean;
    }

    // ── Both LLM attempts failed — build fully from fallback ────────────────
    writeLog("WARN", `${sign} LLM output unusable — using normalized fallback object`);
    console.log(`  [${index}/${total}] ⚠  ${sign} — model output unusable, using fallback`);

    const fallback = normalizeHoroscope({ zodiacSign: sign }, sign, targetDate);
    const finalCheck = validateHoroscope(fallback, sign, targetDate);
    if (finalCheck) {
        writeLog("ERROR", `FAILED: ${sign} ${dateStr} — fallback invalid: ${finalCheck}`);
        writeFailureLog(targetDate, sign, finalCheck);
        throw new Error(`Failed to generate horoscope for ${sign} on ${dateStr}`);
    }
    return fallback;
}

// ==================== BATCH SAVE ====================

function saveHoroscopesForDate(batchResults, targetDate) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });

    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, "0");
    const d = String(targetDate.getDate()).padStart(2, "0");
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const filename = `${y}-${m}-${d}.json`;
    const filepath = path.join(CONFIG.outputDir, filename);
    const today = new Date(); today.setHours(0, 0, 0, 0);

    let existingHoroscopes = [];
    if (fs.existsSync(filepath)) {
        try {
            const existing = JSON.parse(fs.readFileSync(filepath, "utf8"));
            existingHoroscopes = Array.isArray(existing.horoscopes) ? existing.horoscopes : [];
        } catch { writeLog("WARN", `Could not parse ${filename}, starting fresh`); }
    }

    const newSignData = batchResults.filter((r) => r.success).map((r) => r.data);
    const newSigns = new Set(newSignData.map((h) => h.zodiacSign));
    const merged = [
        ...existingHoroscopes.filter((h) => !newSigns.has(h.zodiacSign)),
        ...newSignData,
    ].sort((a, b) => ZODIAC_SIGNS.indexOf(a.zodiacSign) - ZODIAC_SIGNS.indexOf(b.zodiacSign));

    const output = {
        generatedAt: new Date().toISOString(),
        targetDate: { day: targetDate.getDate(), month: targetDate.getMonth() + 1, year: y, weekday: weekdays[targetDate.getDay()] },
        isPast: targetDate < today,
        isFuture: targetDate > today,
        model: CONFIG.model,
        totalSigns: ZODIAC_SIGNS.length,
        successfulSigns: merged.length,
        horoscopes: merged,
    };

    fs.writeFileSync(filepath, JSON.stringify(output, null, 2), "utf8");
    writeLog("INFO", `Batch saved → ${filename} (${merged.length}/${ZODIAC_SIGNS.length} so far)`);
    console.log(`  💾 Batch saved → ${filename} (${merged.length}/${ZODIAC_SIGNS.length} signs so far)`);
    return { filepath, filename };
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
    writeLog("INFO", `---- Starting ${dateStr} (${label}) ----`);

    let totalSuccess = 0, totalFailed = 0;
    const errors = [];

    for (let i = 0; i < ZODIAC_SIGNS.length; i += CONFIG.concurrentLimit) {
        const batchNum = Math.floor(i / CONFIG.concurrentLimit) + 1;
        const totalBatches = Math.ceil(ZODIAC_SIGNS.length / CONFIG.concurrentLimit);
        const batch = ZODIAC_SIGNS.slice(i, i + CONFIG.concurrentLimit);

        console.log(`\n  📦 Batch ${batchNum}/${totalBatches}: ${batch.join(", ")}`);
        writeLog("INFO", `Batch ${batchNum}/${totalBatches}: ${batch.join(", ")}`);

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
                writeLog("ERROR", `FAILED: ${r.sign} ${dateStr} — ${r.error}`);
                writeFailureLog(targetDate, r.sign, r.error);
            }
        }

        saveHoroscopesForDate(batchResults, targetDate);
        writeLog("INFO", `Batch ${batchNum}/${totalBatches} done: ${totalSuccess} total saved`);
        batchResults.length = 0;

        if (i + CONFIG.concurrentLimit < ZODIAC_SIGNS.length) {
            console.log(`\n  ⏳ Waiting 3 seconds...\n`);
            await new Promise((r) => setTimeout(r, 3000));
        }
    }

    writeLog("INFO", `Finished ${dateStr}: ${totalSuccess} ok, ${totalFailed} failed`);
    return { totalSuccess, errors, targetDate };
}

module.exports = { generateHoroscope, generateForDate, saveHoroscopesForDate };