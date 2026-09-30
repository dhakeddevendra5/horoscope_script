import { ollamaChat } from "./ollama.provider.js";

async function generateAIResponse(prompt) {
    return ollamaChat(prompt);
}

export { generateAIResponse };
