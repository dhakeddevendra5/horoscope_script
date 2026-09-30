import {
    PROMPT_LEAK_PATTERNS,
    PHRASE_POOLS,
    FIELD_TOPIC_RULES,
} from "../config/constants.js";

import { seededPick, makeSeed } from "./helpers.js";

const SECTION_FIELDS = [
    "emotion", "profession", "career", "love",
    "family", "health", "moneyAndFinance", "travel",
];

const SCALAR_TEXT_FIELDS = [
    "snippet", "keyAdvice", "mainContent", "todaySolution",
];

function collectAllStrings(obj) {
    const result = [];

    for (const field of SCALAR_TEXT_FIELDS) {
        if (typeof obj[field] === "string") {
            result.push({ path: field, value: obj[field] });
        }
    }

    for (const field of SECTION_FIELDS) {
        const section = obj[field];
        if (!section || typeof section !== "object") continue;

        const stringKeys = ["title", "content", "dashaTitle", "dashaContent"];
        for (const key of stringKeys) {
            if (typeof section[key] === "string") {
                result.push({ path: `${field}.${key}`, value: section[key] });
            }
        }

        const arrayKeys = ["toDo", "toAvoid", "experience"];
        for (const key of arrayKeys) {
            if (Array.isArray(section[key])) {
                section[key].forEach((item, i) => {
                    if (typeof item === "string") {
                        result.push({ path: `${field}.${key}[${i}]`, value: item });
                    }
                });
            }
        }
    }

    return result;
}

function detectPromptLeak(obj) {
    const strings = collectAllStrings(obj);
    for (const { path, value } of strings) {
        for (const pattern of PROMPT_LEAK_PATTERNS) {
            if (pattern.test(value)) {
                if (pattern.global) pattern.lastIndex = 0;
                return `prompt leak in "${path}": matched /${pattern.source}/`;
            }
        }
    }
    return null;
}

const GENERIC_PHRASE_MAP = [
    { pattern: /career momentum sharpens|career momentum improves|career focus sharpens/gi, pool: "careerMomentum", salt: 100 },
    { pattern: /love connections? deepen|emotional connections? deepen/gi, pool: "loveConnection", salt: 200 },
    { pattern: /focus sharpens|concentration sharpens/gi, pool: "focusSharpens", salt: 300 },
    { pattern: /avoid (impulsive |financial )?spending|avoid financial decisions/gi, pool: "avoidSpending", salt: 400 },
    { pattern: /energy (levels? )?(runs? |is )?(high|strong)|physical energy (is |runs )?(high|strong)/gi, pool: "energyPeak", salt: 500 },
    { pattern: /at times you project quiet confidence[^.]*\./gi, pool: "innerWorld", salt: 600 },
    { pattern: /beneath the roles you play[^.]*\./gi, pool: "innerWorld", salt: 610 },
    { pattern: /people (in your life )?(tend to )?underestimat[^.]*\./gi, pool: "hiddenDepth", salt: 700 },
    { pattern: /the resistance you feel is not failure[^.]*\./gi, pool: "resistanceGrowth", salt: 800 },
    { pattern: /your greatest (strength|asset)[^.]*double[^.]*\./gi, pool: "dualityPhrase", salt: 900 },
];

function replaceGenericPhrases(text, sign, targetDate, saltOffset) {
    let out = text;
    for (const entry of GENERIC_PHRASE_MAP) {
        entry.pattern.lastIndex = 0;
        if (entry.pattern.test(out)) {
            entry.pattern.lastIndex = 0;
            const replacement = seededPick(
                PHRASE_POOLS[entry.pool],
                makeSeed(sign, targetDate, entry.salt + saltOffset)
            );
            out = out.replace(entry.pattern, replacement);
        }
        entry.pattern.lastIndex = 0;
    }
    return out;
}

function detectOffTopicContent(obj) {
    const warnings = [];
    for (const [field, rule] of Object.entries(FIELD_TOPIC_RULES)) {
        const section = obj[field];
        if (!section || typeof section !== "object") continue;

        const textToCheck = [section.content, section.dashaContent].filter(Boolean).join(" ");
        for (const pat of rule.offTopicPatterns) {
            if (pat.test(textToCheck)) {
                warnings.push(`off-topic in "${field}": matched /${pat.source}/i`);
                break;
            }
        }
    }
    return warnings.length > 0 ? warnings.join(" | ") : null;
}

function cleanGrammarArtifacts(text) {
    return text
        .replace(/\[[^\]]*\]/g, "")
        .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
        .replace(/^#{1,4}\s+/gm, "")
        .replace(/([^\s])—([^\s])/g, "$1 — $2")
        .replace(/ {2,}/g, " ")
        .replace(/ ([.,;:!?])/g, "$1")
        .replace(/([.!?])\s*([.!?])/g, "$1")
        .replace(/`/g, "")
        .replace(/\([^)]*$/, (m) => m + ")")
        .replace(/([.!?])([A-Z])/g, "$1 $2")
        .replace(/\byou was\b/gi, "you were")
        .replace(/\byou is\b/gi, "you are")
        .replace(/\b(\w+) \1\b/gi, "$1")
        .trim();
}

function cleanSection(section, sign, targetDate, saltOffset) {
    if (!section || typeof section !== "object") return section;

    const cleaned = { ...section };

    const stringKeys = ["title", "content", "dashaTitle", "dashaContent"];
    for (const key of stringKeys) {
        if (typeof cleaned[key] === "string") {
            cleaned[key] = replaceGenericPhrases(cleaned[key], sign, targetDate, saltOffset);
            cleaned[key] = cleanGrammarArtifacts(cleaned[key]);
        }
    }

    const arrayKeys = ["toDo", "toAvoid", "experience"];
    for (const key of arrayKeys) {
        if (Array.isArray(cleaned[key])) {
            cleaned[key] = cleaned[key].map((item) =>
                typeof item === "string"
                    ? cleanGrammarArtifacts(replaceGenericPhrases(item, sign, targetDate, saltOffset + 1))
                    : item
            );
        }
    }

    return cleaned;
}

function runQA(obj, sign, targetDate) {
    const leakReason = detectPromptLeak(obj);
    if (leakReason) {
        return { clean: null, leakReason, topicWarning: null };
    }

    const clean = { ...obj };

    SCALAR_TEXT_FIELDS.forEach((field, idx) => {
        if (typeof clean[field] !== "string") return;
        clean[field] = replaceGenericPhrases(clean[field], sign, targetDate, idx * 7);
        clean[field] = cleanGrammarArtifacts(clean[field]);
    });

    SECTION_FIELDS.forEach((field, idx) => {
        if (clean[field] && typeof clean[field] === "object") {
            clean[field] = cleanSection(clean[field], sign, targetDate, (idx + 10) * 7);
        }
    });

    const topicWarning = detectOffTopicContent(clean);

    return { clean, leakReason: null, topicWarning };
}

export { runQA };
