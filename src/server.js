import express from "express";
import cors from "cors";
import connectDB from "./config/db.js";
import env from "./config/env.js";
import appSetup from "./app.js";

const app = express();

const startServer = async () => {
    try {
        // 1. Load project connections
        await connectDB();
        
        app.use(cors({
            origin: env.FRONTEND_URL, 
            methods: ["GET", "POST"],
            credentials: true
        }));

        // 3. Health check in server
        app.get("/health", (req, res) => res.json({ status: "OK", timestamp: new Date() }));

        // 4. Connect app logic (routes)
        appSetup(app);
        
        // 5. Start the Express server
        app.listen(env.PORT, () => {
            console.log(`🚀 Server running on port ${env.PORT}`);
        });
    } catch (error) {
        console.error("❌ Server failed to start:", error);
        process.exit(1);
    }
};

startServer();
