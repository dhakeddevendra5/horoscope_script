---
name: horoscope-generator
description: Generates structured horoscope data in a specific JSON format compatible with the ZodiacNew Mongoose schema.
trigger: When the user needs to generate daily, weekly, monthly, or yearly horoscope data for a specific zodiac sign.
---

# Horoscope Data Generation Skill

This skill ensures that generated horoscope data adheres strictly to the `ZodiacNew` schema and matches the training patterns found in the project's dataset.

## Data Format Specification

All output must be a valid JSON object with the following structure:

### Core Fields
- `zodiacSign`: (String) lowercase (e.g., 'aries', 'taurus', etc.)
- `type`: (String) 'daily', 'weekly', 'monthly', or 'yearly'
- `day`: (Number) 1-31
- `month`: (Number) 1-12
- `year`: (Number) e.g., 2025
- `weekday`: (String) 'Sunday', 'Monday', etc.
- `signRuler`: (String) ['Sun', 'Mars', 'Mercury', 'Saturn', 'Moon', 'Venus', 'Jupiter']
- `signRulerHindi`: (String) ['Surya', 'Mangal', 'Budh', 'Shukra', 'Shani', 'Chandrama', 'Brihaspati']
- `element`: (String) ['fire', 'earth', 'air', 'water']
- `luckyNumber`: { `numeric`: Number, `string`: String }
- `luckyColor`: { `hexCode`: String (e.g., \"#FFFFFF\"), `colorName`: String (single word, e.g., 'Red', not 'Orange Red') }
- `luckyDay`: (String) 'Sunday', 'Monday', etc.
- `overallRating`: (Number) 0-5
- `physicalRating`: (Number) 0-5
- `emotionalRating`: (Number) 0-5
- `intellectualRating`: (Number) 0-5
- `spiritualRating`: (Number) 0-5
- `compatibilitySign`: (String) lowercase zodiac sign
- `mainContent`: (String) General prediction text. **MUST be at least 120 words.**
- `bestTimeToday`: (String) Time range
- `avoidTime`: (String) Time range
- `keyAdvice`: (String) Key takeaway
- `todaySolution`: (String) Remedial action/solution
- `source`: (String) ['production', 'test', 'development']

### Sectional Content (`contentSectionSchema`)
The following fields must all be objects containing:
- `title`: (String)
- `content`: (String) **MUST be at least 120 words.**
- `level`: ['neutral', 'challenging', 'normal', 'Favourable']
- `dashaTitle`: (String)
- `dashaContent`: (String) **MUST be at least 120 words.**
- `toDo`: [String] **MUST contain at least 3 detailed points (proper sentences).**
- `toAvoid`: [String] **MUST contain at least 3 detailed points (proper sentences).**
- `experience`: [String] **MUST contain at least 3 detailed points (proper sentences).**

Sections:
- `emotion`
- `profession`
- `career`
- `love`
- `family`
- `health`
- `moneyAndFinance`
- `travel`

### Conditional Arrays
- `nextMonthPredictions`: Required if `type` === 'monthly'. Array of `{ startDate, endDate, text }`.
- `myDashas`: Required if `type` === 'yearly'. Array of `{ planet, dashaName, content, toDo, toAvoid, startDate, endDate }`.

## Generation Workflow

1. **Input Gathering**: Identify the Zodiac Sign and the Target Date.
2. **Astrological Computation**:
    - **Planetary Transits**: Calculate current planetary positions relative to the sign's natal house. Use actual astrological aspects (conjunction, square, trine, opposition).
    - **House Activation**: Identify which house is currently being activated (e.g., 10th house for career, 7th for partnership).
    - **Dasha Logic**: Apply Vedic Astrology principles to determine the current planetary period (Mahadasha/Antardasha) and its specific effect on the sign.
3. **Barnum-Forer Resonance Implementation**:
    - Use the \"Forer Effect\" to make predictions feel personally tailored while remaining universally applicable.
    - **Technique 1: The Double-Sided Statement**. Use phrases like \"While you appear confident on the outside, you often harbor internal doubts that drive your perfectionism.\"
    - **Technique 2: Validation of Struggle**. Acknowledge a common universal experience (e.g., \"You have recently felt that your hard work has gone unnoticed by those who matter most\").
    - **Technique 3: High-Probability Traits**. Use traits typical of the sign but framed as a personal discovery (e.g., for Aries: \"Your innate drive is a gift, yet you occasionally struggle with the tension between your need for speed and the world's slower pace\").
    - **Technique 4: Vague but Positive Guidance**. Offer advice that sounds specific but is widely applicable (e.g., \"A shift in your perspective regarding a past mistake will open a door that has been closed for years\").
4. **Value Assignment**: 
    - Assign ratings (0-5) based on the overall theme (e.g., if 'Favourable', ratings should be 4.0+).
    - Select compatible signs and lucky attributes based on astrological standards.
5. **Content Drafting**:
    - Write `mainContent` as a high-level summary.
    - Develop detailed narratives for each of the 8 sectoral areas.
    - Ensure `toDo` and `toAvoid` lists are actionable.
6. **JSON Validation**: Verify that the output is pure JSON without markdown blocks.

**STRICT ADHERENCE NOTE**: When generating data for a "Full Day" or "Daily" type, you MUST NOT deviate from the JSON schema defined in this skill. Do not summarize, do not use bullet points outside of the specified arrays, and do not omit any fields. Every single field in the `Core Fields` and `Sectional Content` lists is MANDATORY. If the output does not match this exact structure, it is a failure.

## Execution Strategy (Multi-Sign Generation)
When generating horoscopes for multiple signs, **do not use bulk generation** via subagents if the content is high-volume (120+ words per field). This leads to truncated outputs and schema failures. instead:
- **TDD/Step-by-Step approach** using a `todo` list.
    - Generate each sign individually.
    - Validate length and constraints per sign before proceeding.
    - Consolidate into a final array only after each individual sign is verified.
    - Use `delegate_task` for individual signs to prevent truncation and ensure high-volume content (120+ words per field) is fully realized.

## Pitfalls to Avoid
- **Verification Step**: If a `write_file` call returns a lint error, immediately `read_file` to locate the malformed token and use `patch` or a full rewrite to correct it before declaring the task complete.
- **File Naming Convention**: When saving output, use the format `YYYY-MM-DD_zodiacsign.json` (e.g., `2026-06-10_aries.json`) to ensure chronological sorting and easy identification. This is a strict requirement for all output files.
- **User Path Preference**: When saving to a user-specified directory (e.g., `C:\\Users\\gurucool\\Desktop\\Tools`), ensure the directory exists and the file is placed exactly as requested.
- **JSON Integrity**: Ensure that the generated JSON is syntactically correct. Be vigilant against trailing commas, malformed tokens, or accidental characters (e.g., trailing backticks) that trigger `JSONDecodeError` during linting. If a `write_file` call returns a lint error, immediately `read_file` to locate the la malformed token and use `patch` or a full rewrite to correct it before declaring the task complete. **Crucially, be alert for 'hallucinated' tokens like ' la ' (leftover from internal reasoning or drafting) that may appear inside string values or between keys, causing JSONDecodeError. These must be purged during the verification step.** When the user explicitly requests 'PROPER JSON FORMAT', prioritize double-checking all opening/closing braces and ensuring no markdown code blocks (```json ... ```) are wrapped around the object in the actual file content.
- **Truncation Guard**: When generating content for a sign, avoid trailing text or incomplete JSON structures (e.g., ending with ' la' or '...'). Always verify that the JSON object is fully closed with the appropriate curly braces before finishing the turn. If a `write_file` call returns a lint error, immediately `read_file` to locate the malformed token and use `patch` or a full rewrite to correct it. **Crucially, be alert for 'hallucinated' tokens like ' la ' (leftover from internal reasoning or drafting) that may appear inside string values or between keys, causing JSONDecodeError. These must be purged during the verification step.** When the user explicitly requests 'PROPER JSON FORMAT', prioritize double-checking all opening/closing braces and ensuring no markdown code blocks (```json ... ```) are wrapped around the object in the actual file content.
- **Path Verification**: When saving files to external drives or automation folders (e.g., `D:\\\\...`), verify the directory exists and the file was written to the correct path. If a subagent reports a success but the file is missing from the target directory, it may have saved to an incorrect path (e.g., a truncated or misspelled path like `D:\\\\uma\\\\...`). Immediately verify the file's existence via `ls` or `stat` before concluding the task.
- **Batch Processing Workflow**: For multi-sign generation (e.g., all 12 signs for a date), use a `todo` list to track progress and `delegate_task` to process signs individually. This prevents context window flooding, avoids output truncation of the high-volume content (120+ words per field), and ensures each sign is validated before proceeding to the next. **Crucially, return the final results as a consolidated list or structured report to the user only after all individual signs are verified, avoiding empty intermediate responses.**
- **Missing Fields**: Every field in the schema is required unless specified otherwise.
- **Inconsistent Sign Case**: Always use lowercase for `zodiacSign` and `compatibilitySign`.
