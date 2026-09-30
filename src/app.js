import express from "express";
import horoscopeRoutes from "./routes/horoscope.routes.js";
import { requireApiKey } from "./middleware/auth.middleware.js";

export default function appSetup(app) {
    // Middleware
    app.use(express.json());
    
    // Apply Authentication to Horoscope API routes
    app.use("/api/horoscope", requireApiKey, horoscopeRoutes);
}
