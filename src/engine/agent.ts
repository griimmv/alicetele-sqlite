import { toolRegistry } from "./tools/indextools.ts";
import { parseJSONFromText } from "./parser.ts";

const LLM_TIMEOUT = 30000;
const TOOL_TIMEOUT = 20000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  const abortPromise = signal && new Promise<T>((_, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort);
  });
  return Promise.race([promise, timeoutPromise, ...(abortPromise ? [abortPromise] : [])]).finally(() => clearTimeout(timer));
}

const SYSTEM_PROMPT = `You are a helpful assistant with access to Wikipedia and Stack Overflow. Use the wikipedia tool for factual topics (people, places, history, concepts). Use the stackoverflow tool for programming questions, coding errors, debugging, or technical software development topics. For general chat or simple queries, answer directly.

Respond ONLY with valid JSON matching this schema, no other text:
{
  "summary": "2-3 paragraph synthesis of the information",
  "quotes": [{"text": "a key quote", "source": "Article title", "url": "https://..."}],
  "sources": [{"title": "Article title", "url": "https://..."}]
}`;

export function createAgent(llm: any) {
  return { llm, tools: toolRegistry.map(entry => entry.tool) };
}

interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export async function runAgent(
  agent: any,
  input: string,
  history: any[] = [],
  signal?: AbortSignal
): Promise<{ content: string; tokens: TokenUsage }> {
  const messages: any[] = [...history, { role: "user", content: input }];
  const maxLoops = 2;
  const tokens: TokenUsage = { input: 0, output: 0, total: 0 };

  for (let i = 0; i < maxLoops; i++) {
    const result: any = await withTimeout(
      agent.llm.invoke(
        [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        { tools: agent.tools, signal }
      ),
      LLM_TIMEOUT,
      "LLM invoke"
    );

    if (result.usage_metadata) {
      const inTokens = result.usage_metadata.input_tokens ?? 0;
      const outTokens = result.usage_metadata.output_tokens ?? 0;
      tokens.input += inTokens;
      tokens.output += outTokens;
      tokens.total += result.usage_metadata.total_tokens ?? (inTokens + outTokens);
    }

    const content =
      typeof result.content === "string"
        ? result.content
        : Array.isArray(result.content)
          ? result.content
              .map((block: any) => (typeof block === "string" ? block : block?.text ?? ""))
              .join("")
          : String(result.content ?? result);

    if (result.tool_calls?.length > 0) {
      messages.push({ role: "assistant", content: "", tool_calls: result.tool_calls });
      for (const tc of result.tool_calls) {
        const tool = agent.tools.find((tool: any) => tool.name === tc.name);
        if (tool) {
          const output: string = await withTimeout(
            tool.func(tc.args),
            TOOL_TIMEOUT,
            `tool(${tc.name})`,
            signal
          );
          messages.push({ role: "tool", content: output, tool_call_id: tc.id });
        }
      }
      continue;
    }

    const parsed = parseJSONFromText(content);
    if (parsed) return { content: JSON.stringify(parsed), tokens };
    return { content, tokens };
  }

  return {
    content: JSON.stringify({
      summary: "I couldn't complete this request within the allowed steps.",
      quotes: [],
      sources: []
    }),
    tokens,
  };
}


