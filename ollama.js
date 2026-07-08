"use strict";

const https = require("https");
const http = require("http");
const { CONFIG } = require("./config");
const { writeLog } = require("./logger");

// ==================== HTTP HELPER ====================

function httpPost(url, bodyObj) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(bodyObj);
        const parsed = new URL(url);
        const lib = parsed.protocol === "https:" ? https : http;

        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
            path: parsed.pathname,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(bodyStr),
            },
        };

        const req = lib.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        reject(new Error("Invalid JSON response from Ollama"));
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}`));
                }
            });
        });

        req.on("error", reject);
        req.write(bodyStr);
        req.end();
    });
}

// ==================== OLLAMA API ====================

/**
 * Send a prompt to Ollama and return the trimmed text response.
 * Retries up to CONFIG.maxRetries times on failure.
 *
 * hermes3:8b context window = 8192 tokens.
 * Prompt runs ~2000 tokens → leaves ~6192 for output.
 * num_predict capped at 4096 so we stay well inside the window.
 * num_ctx set explicitly so Ollama does not default to a smaller value.
 *
 * @param {string} prompt
 * @param {number} [retryCount=0]
 * @returns {Promise<string>}
 */
async function callOllama(prompt, retryCount = 0) {
    try {
        const response = await httpPost(CONFIG.ollamaUrl, {
            model: CONFIG.model,
            prompt: prompt,
            stream: false,
            options: {
                temperature: CONFIG.temperature,
                num_predict: 4096,
                num_ctx: 32768,   
            },
        });
        return response.response.trim();
    } catch (error) {
        if (retryCount < CONFIG.maxRetries) {
            const msg = `Retry ${retryCount + 1}/${CONFIG.maxRetries} for Ollama call...`;
            console.log(`     ⚠ ${msg}`);
            writeLog("WARN", msg);
            await new Promise((r) => setTimeout(r, 2000));
            return callOllama(prompt, retryCount + 1);
        }
        throw error;
    }
}

module.exports = { callOllama };