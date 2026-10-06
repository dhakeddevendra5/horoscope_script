import express from "express";
import { getHoroscope, generateHoroscope, generateHoroscopeRange, generateHoroscopeMonth, stopGenerationController, removeHoroscope, removeLogs } from "../controllers/horoscope.controller.js";
const router = express.Router();

router.get("/:sign", getHoroscope);
router.post("/generate", generateHoroscope);
router.post("/generate/stop", stopGenerationController);
router.post("/generate/range", generateHoroscopeRange);
router.post("/generate/month", generateHoroscopeMonth);
router.delete("/remove", removeHoroscope);
router.delete("/remove/logs", removeLogs)

export default router;
