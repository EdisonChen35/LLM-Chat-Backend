import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

const REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";

// Any OpenAI-compatible chat completions endpoint works here — NVIDIA's
// hosted models by default, or a local Ollama instance (LLM_API_URL=
// http://localhost:11434/v1/chat/completions, no LLM_API_KEY needed) for
// the local-LLM bonus requirement. See docs/PROJECT_SPEC.md requirement 2.
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.apiUrl = this.config.get<string>("LLM_API_URL") ?? DEFAULT_API_URL;
    this.apiKey = this.config.get<string>("LLM_API_KEY");
    this.model = this.config.get<string>("LLM_MODEL") ?? DEFAULT_MODEL;
  }

  async generateReply(messages: LlmMessage[]): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json",
      };
      if (this.apiKey !== undefined) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          max_tokens: 2048,
          temperature: 0.6,
          top_p: 0.95,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`LLM API responded with ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content;
      if (content === undefined) {
        throw new Error("LLM API response did not include a message");
      }
      return content;
    } catch (error) {
      this.logger.error("LLM request failed", error instanceof Error ? error.stack : error);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
