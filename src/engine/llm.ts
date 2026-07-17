import { ChatOpenAI } from "@langchain/openai";
import { config } from "../lib/config.ts";

export function createLLM(): ChatOpenAI | null {
  if (!config.openaiApiKey) {
    console.warn("OPENAI_API_KEY not set — LLM features disabled.");
    return null;
  }
  return new ChatOpenAI({
    model: config.openaiModel,
    temperature: 0,
    apiKey: config.openaiApiKey,
  });
}
