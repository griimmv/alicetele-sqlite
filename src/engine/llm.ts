import { ChatOpenAI } from "@langchain/openai";
import { config } from "../lib/config.ts";

export function createLLM(): ChatOpenAI {
  return new ChatOpenAI({
    model: config.openaiModel,
    temperature: 0,
    apiKey: config.openaiApiKey,
  });
}
