import https from "https";
import http from "http";
import env from "../../config/env.js";

function httpPost(url, bodyObj, headers = {}) {
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
                ...headers
            },
        };

        const req = lib.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data)); }
                    catch { reject(new Error("Invalid JSON response")); }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on("error", reject);
        req.write(bodyStr);
        req.end();
    });
}

async function ollamaChat(prompt) {
    const headers = {};
    if (env.OLLAMA_API_KEY) {
        headers['Authorization'] = `Bearer ${env.OLLAMA_API_KEY}`;
    }
    const response = await httpPost(env.OLLAMA_URL, {
        model: env.OLLAMA_MODEL,
        prompt: prompt,
        stream: false,
        options: {
            temperature: env.TEMPERATURE,
            num_predict: 4096,
            num_ctx: 32768,
        },
    }, headers);
    return response.response ? response.response.trim() : "";
}

export { ollamaChat };
