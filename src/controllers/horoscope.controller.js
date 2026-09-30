import Horoscope from "../models/horoscope.model.js";
import { generateForDate, generateForDateRange, generateForMonth, stopGeneration } from "../services/horoscope.service.js";

// Get horoscope for a specific sign and date
export const getHoroscope = async (req, res) => {
    try {
        const { sign } = req.params;
        const { date } = req.query; // e.g. YYYY-MM-DD
        
        let targetDate = new Date();
        if (date) {
            const [y, m, d] = date.split("-").map(Number);
            targetDate = new Date(y, m - 1, d);
        }

        const h = await Horoscope.findOne({
            zodiacSign: { $regex: new RegExp(`^${sign}$`, "i") },
            day: targetDate.getDate(),
            month: targetDate.getMonth() + 1,
            year: targetDate.getFullYear()
        });

        if (!h) {
            return res.status(404).json({ message: "Horoscope not found for this date" });
        }

        res.json(h);
    } catch (error) {
        console.error("Error fetching horoscope:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Generate horoscopes for a specific date on demand
export const generateHoroscope = async (req, res) => {
    try {
        const { date } = req.body;
        let targetDate = new Date();
        if (date) {
            const [y, m, d] = date.split("-").map(Number);
            targetDate = new Date(y, m - 1, d);
        }

        // We run the generation asynchronously and just return an OK
        generateForDate(targetDate).catch(err => {
            console.error("Async generation failed:", err);
        });

        res.json({ message: `Generation started for ${targetDate.toISOString()}` });
    } catch (error) {
        console.error("Error starting generation:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Generate horoscopes for a specific date range
export const generateHoroscopeRange = async (req, res) => {
    try {
        const { startDate, endDate } = req.body;
        
        if (!startDate || !endDate) {
            return res.status(400).json({ message: "startDate and endDate are required in format YYYY-MM-DD" });
        }

        const [sy, sm, sd] = startDate.split("-").map(Number);
        const [ey, em, ed] = endDate.split("-").map(Number);
        
        const start = new Date(sy, sm - 1, sd);
        const end = new Date(ey, em - 1, ed);

        if (end < start) {
            return res.status(400).json({ message: "endDate must be on or after startDate" });
        }

        // Run asynchronously
        generateForDateRange(start, end).catch(err => {
            console.error("Async range generation failed:", err);
        });

        res.json({ message: `Generation started for range ${startDate} to ${endDate}` });
    } catch (error) {
        console.error("Error starting range generation:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Generate horoscopes for a full month
export const generateHoroscopeMonth = async (req, res) => {
    try {
        const { year, month } = req.body;
        
        if (!year || !month) {
            return res.status(400).json({ message: "year and month are required" });
        }

        // Run asynchronously
        generateForMonth(Number(year), Number(month)).catch(err => {
            console.error("Async month generation failed:", err);
        });

        res.json({ message: `Generation started for ${year}-${String(month).padStart(2, '0')}` });
    } catch (error) {
        console.error("Error starting month generation:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Stop generation
export const stopGenerationController = async (req, res) => {
    try {
        stopGeneration();
        res.json({ message: "Generation stop signal sent. It will abort before the next batch or day." });
    } catch (error) {
        console.error("Error stopping generation:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
