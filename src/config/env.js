import dotenv from "dotenv";
dotenv.config();

export default {
  PORT: process.env.PORT || 3000,
  MONGO_URI: process.env.MONGO_URI,
  OLLAMA_API_KEY: process.env.OLLAMA_API_KEY,
  OLLAMA_MODEL: process.env.OLLAMA_MODEL,
  OLLAMA_URL: process.env.OLLAMA_URL,
  TEMPERATURE: parseFloat(process.env.TEMPERATURE),
  CONCURRENT_LIMIT: parseInt(process.env.CONCURRENT_LIMIT),
  FRONTEND_URL: process.env.FRONTEND_URL,
  API_KEY: process.env.API_KEY || "my-secret-dev-key"
};
