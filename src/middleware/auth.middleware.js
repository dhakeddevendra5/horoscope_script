import env from "../config/env.js";

export const requireApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;

    if (!apiKey) {
        return res.status(401).json({ message: "Authentication required: Missing API Key" });
    }

    if (apiKey !== env.API_KEY) {
        return res.status(403).json({ message: "Authentication failed: Invalid API Key" });
    }

    next();
};
