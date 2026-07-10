import { wikipediaTool } from "./wikipedia.ts";
import type { StructuredToolInterface } from "@langchain/core/tools";

export const toolRegistry: StructuredToolInterface[] = [
  wikipediaTool,
];

export function getTool(name: string): StructuredToolInterface | undefined {
  return toolRegistry.find(t => t.name === name);
}
