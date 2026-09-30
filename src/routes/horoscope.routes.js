import express from "express";
import { getHoroscope, generateHoroscope, generateHoroscopeRange, generateHoroscopeMonth } from "../controllers/horoscope.controller.js";
const router = express.Router();

router.get("/:sign", getHoroscope);
router.post("/generate", generateHoroscope);
router.post("/generate/range", generateHoroscopeRange);
router.post("/generate/month", generateHoroscopeMonth);

export default router;
