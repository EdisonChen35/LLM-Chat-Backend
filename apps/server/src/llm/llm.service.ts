import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

const REQUEST_TIMEOUT_MS = 60_000;

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.apiUrl =
      this.config.get<string>("NVIDIA_API_URL") ??
      "https://integrate.api.nvidia.com/v1/chat/completions";
    const apiKey = this.config.get<string>("NVIDIA_API_KEY");
    if (apiKey === undefined) {
      throw new InternalServerErrorException("NVIDIA_API_KEY is not configured");
    }
    this.apiKey = apiKey;
    this.model =
      this.config.get<string>("NVIDIA_MODEL") ?? "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";
  }

  async generateReply(messages: LlmMessage[]): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
          "Accept": "application/json",
        },
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
        throw new Error(`NVIDIA API responded with ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content;
      if (content === undefined) {
        throw new Error("NVIDIA API response did not include a message");
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
