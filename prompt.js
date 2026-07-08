"use strict";

const { SIGN_META, SIGN_PERSONALITY, TIME_WINDOWS, ZODIAC_SIGNS } = require("./config");

// ==================== SEEDED PICKER ====================

function seededPick(arr, seed) {
    const s = (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
    return arr[s % arr.length];
}

function makeSeed(sign, targetDate, salt = 0) {
    return (ZODIAC_SIGNS.indexOf(sign) * 7919 +
        targetDate.getDate() * 131 +
        (targetDate.getMonth() + 1) * 37 +
        (targetDate.getFullYear() % 100) * 17 +
        salt) >>> 0;
}

// ==================== NUMBER WORDS ====================

const NUMBER_WORDS = {
    1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five",
    6: "Six", 7: "Seven", 8: "Eight", 9: "Nine"
};

// ==================== PROMPT BUILDER ====================
//
// Three blocks kept deliberately compact for hermes3:8b (8 192-token window).
// Prompt target: ~2 000 tokens.  Output target: ≤ 4 096 tokens.
// Total stays well inside the 8 192 context limit.
//
// BLOCK A — subject context   (~300 tokens)
// BLOCK B — writing rules     (~500 tokens, compressed from original ~900)
// BLOCK C — JSON template     (~1 200 tokens, compressed from original ~2 000)
//
function buildHoroscopePrompt(sign, targetDate) {
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const meta = SIGN_META[sign];
    const p = SIGN_PERSONALITY[sign];
    const day = targetDate.getDate();
    const month = targetDate.getMonth() + 1;
    const year = targetDate.getFullYear();
    const weekday = weekdays[targetDate.getDay()];

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tense = targetDate < today ? "past" : targetDate > today ? "future" : "present";
    const tenseNote = tense === "past" ? "Past date — write in past tense."
        : tense === "future" ? "Future date — write in future tense."
            : "Today — write in present tense.";

    // Pre-seeded time windows so the model never generates them
    const compat = seededPick(meta.compatibility, makeSeed(sign, targetDate, 1));
    const workTime = seededPick(TIME_WINDOWS.afternoon, makeSeed(sign, targetDate, 10));
    const loveTime = seededPick(TIME_WINDOWS.evening, makeSeed(sign, targetDate, 20));
    const healthPeak = seededPick(TIME_WINDOWS.earlyMorning, makeSeed(sign, targetDate, 30));
    const healthDip = seededPick(TIME_WINDOWS.lateAfternoon, makeSeed(sign, targetDate, 40));
    const moneyTime = seededPick(TIME_WINDOWS.midMorning, makeSeed(sign, targetDate, 50));
    const avoidTime = seededPick(TIME_WINDOWS.noon, makeSeed(sign, targetDate, 60));
    const careerTime = seededPick(TIME_WINDOWS.earlyAfternoon, makeSeed(sign, targetDate, 70));
    const familyTime = seededPick(TIME_WINDOWS.earlyMorning, makeSeed(sign, targetDate, 80));
    const travelTime = seededPick(TIME_WINDOWS.morning, makeSeed(sign, targetDate, 90));
    const luckyNum = (makeSeed(sign, targetDate, 99) % 9) + 1;
    const luckyWord = NUMBER_WORDS[luckyNum];

    // ════════════════════════════════════════════════════════════════
    // BLOCK A — SUBJECT CONTEXT
    // ════════════════════════════════════════════════════════════════
    const blockA = `=== SUBJECT ===
Sign: ${sign} | ${weekday} ${day}/${month}/${year} | ${tenseNote}
Ruler: ${meta.ruler} | Element: ${meta.element} | Compatible: ${compat}
Nature: ${p.coreNature}
Life theme: ${p.lifeTheme}
Weakness: ${p.weakness}
Body zone: ${p.bodyZone}
Work: ${p.workStyle}
Love: ${p.loveStyle}
Money: ${p.moneyStyle}
Stress: ${p.stressSignal}
Signature phrase (copy verbatim into mainContent): "${p.uniquePhrase}"

Time windows:
  Work=${workTime} | Career=${careerTime} | Love=${loveTime}
  Health peak=${healthPeak} | Health dip=${healthDip}
  Money=${moneyTime} | Family=${familyTime} | Travel=${travelTime} | Avoid=${avoidTime}`;

    // ════════════════════════════════════════════════════════════════
    // BLOCK B — WRITING RULES  (compressed ~45%)
    // ════════════════════════════════════════════════════════════════
    const blockB = `=== RULES ===
VOICE: Every sentence must be specific to ${sign}. Use "you/your". Never open any field with "On ${weekday}".

BARNUM-FORER — weave all 6 into content, dashaContent, mainContent:
  T1=name what reader privately thinks but hasn't said aloud
  T2=name a strength and its shadow cost in the same sentence
  T3=touch one universal unspoken desire
  T4=tell reader they are more complex than others realise
  T5=reframe struggle as the price of what is being built
  T6=speak as if you know them personally — warm, zero distance

SEO/DIRECTNESS — strip all hedges:
  BANNED: may, might, could, perhaps, possibly, seems to, tends to, there is a chance, energy suggests, opportunities arise, this day invites.
  REQUIRED: first sentence of every field is a direct declarative statement.

TOPICS (one per field, no crossover):
  emotion=inner mood only | profession=work tasks only | career=long-term trajectory only
  love=romance/partner only | family=home/relatives only | health=body only
  moneyAndFinance=spending/saving/investment only | travel=journeys/movement only

ARRAYS (each field):
  toDo — 3 concrete imperative actions for ${sign} today
  toAvoid — 3 specific traps to skip today
  experience — 3 confirmatory statements starting "You notice" / "You find" / "A sense of"

LENGTHS:
  content, dashaContent = 60-100 words each
  mainContent = 150-200 words | todaySolution = 80-120 words (Vedic: colour, direction, mantra, food, body zone)
  snippet = 40-60 words, format: "${sign} Horoscope Today: [career]. [love]. [money]."
  keyAdvice = 1 sentence, max 20 words, no hedging

OUTPUT: JSON only. Start with { end with }. No markdown, no explanation, no text outside the braces. No square brackets inside any string value.`;

    // ════════════════════════════════════════════════════════════════
    // BLOCK C — JSON TEMPLATE  (hints shortened ~50%)
    // ════════════════════════════════════════════════════════════════
    const sec = (field, topic, time) =>
        `  "${field}": {
    "title": "<${sign} ${field} title 5-7 words>",
    "content": "<${topic}, ref ${time}, T1+T2+T4, 60-100w>",
    "level": "<neutral|challenging|normal>",
    "dashaTitle": "<Vedic dasha title 5-7 words>",
    "dashaContent": "<${field} planetary influence, T5, 60-100w>",
    "toDo": ["<action>","<action>","<action>"],
    "toAvoid": ["<avoid>","<avoid>","<avoid>"],
    "experience": ["<You notice...>","<You find...>","<A sense of...>"]
  }`;

    const blockC = `=== OUTPUT ===
Output ONLY the JSON object. No markdown. Nothing outside the braces.

{
  "zodiacSign": "${sign}",
  "type": "daily",
  "day": ${day},
  "month": ${month},
  "year": ${year},
  "weekday": "${weekday}",
  "signRuler": "${meta.ruler}",
  "element": "${meta.element}",
  "luckyNumber": { "numeric": ${luckyNum}, "string": "${luckyWord}" },
  "luckyColor": { "hexCode": "<valid #RRGGBB>", "colorName": "<name>" },
  "luckyDay": "<day of week>",
  "overallRating": "<float 2.5-4.8>",
  "physicalRating": "<float 2.0-5.0>",
  "emotionalRating": "<float 2.0-5.0>",
  "intellectualRating": "<float 2.0-5.0>",
  "spiritualRating": "<float 2.0-5.0>",
  "compatibilitySign": "${compat}",
  "bestTimeToday": "${workTime}",
  "avoidTime": "${avoidTime}",
  "snippet": "<${sign} Horoscope Today: [career]. [love]. [money]. 40-60w>",
  "keyAdvice": "<1 sentence max 20w direct no hedge>",
${sec("emotion", `${sign} inner mood/psychological state`, "no time window")},
${sec("profession", `${sign} work tasks and output`, workTime)},
${sec("career", `${sign} long-term trajectory`, careerTime)},
${sec("love", `${sign} romance and partner communication`, loveTime)},
${sec("family", `${sign} home life and relatives`, familyTime)},
${sec("health", `${sign} body energy, peak ${healthPeak}, dip ${healthDip}, zone ${p.bodyZone}`, healthPeak)},
${sec("moneyAndFinance", `${sign} spending/saving/investment`, moneyTime)},
${sec("travel", `${sign} journeys/commutes/movement`, travelTime)},
  "mainContent": "<150-200w, all life areas, all 6 T-techniques, include verbatim: ${p.uniquePhrase}, ref 3+ time windows, zero hedge words>",
  "todaySolution": "<80-120w Vedic remedy: colour to wear, direction to face, mantra, food, care for ${p.bodyZone}>"
}`;

    return `${blockA}\n\n${blockB}\n\n${blockC}`;
}

module.exports = { buildHoroscopePrompt };
