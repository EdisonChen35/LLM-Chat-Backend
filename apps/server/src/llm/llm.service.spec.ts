import { ConfigService } from "@nestjs/config";

import { LlmService } from "./llm.service";

const makeConfig = (values: Record<string, string>): ConfigService => {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
};

const sseStream = (lines: string[]): ReadableStream<Uint8Array> => {
  const body = lines.map((line) => `data: ${line}\n\n`).join("");
  const bytes = new TextEncoder().encode(body);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
};

describe("LlmService", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("returns the reply content from a successful completion", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: "hi there" } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new LlmService(makeConfig({ LLM_API_KEY: "test-key" }));
    const result = await service.generateReply([{ role: "user", content: "hello" }]);

    expect(result).toBe("hi there");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
  });

  // Local providers (e.g. Ollama) don't need an API key.
  it("omits the Authorization header when no API key is configured", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: "hi there" } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new LlmService(
      makeConfig({ LLM_API_URL: "http://localhost:11434/v1/chat/completions" }),
    );
    await service.generateReply([{ role: "user", content: "hello" }]);

    const [, options] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it("throws when the API responds with a non-2xx status", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve("rate limited"),
    }) as unknown as typeof fetch;

    const service = new LlmService(makeConfig({ LLM_API_KEY: "test-key" }));

    await expect(service.generateReply([{ role: "user", content: "hello" }])).rejects.toThrow(
      "LLM API responded with 429",
    );
  });

  it("throws when the response has no message content", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [] }),
    }) as unknown as typeof fetch;

    const service = new LlmService(makeConfig({ LLM_API_KEY: "test-key" }));

    await expect(service.generateReply([{ role: "user", content: "hello" }])).rejects.toThrow(
      "did not include a message",
    );
  });

  describe("streamReply", () => {
    it("calls onToken for each chunk and returns the full accumulated text", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        body: sseStream([
          JSON.stringify({ choices: [{ delta: { content: "Hel" } }] }),
          JSON.stringify({ choices: [{ delta: { content: "lo" } }] }),
          "[DONE]",
        ]),
      }) as unknown as typeof fetch;

      const service = new LlmService(makeConfig({ LLM_API_KEY: "test-key" }));
      const onToken = jest.fn();
      const result = await service.streamReply([{ role: "user", content: "hi" }], onToken);

      expect(onToken.mock.calls).toEqual([["Hel"], ["lo"]]);
      expect(result).toBe("Hello");
    });

    it("throws when the API responds with a non-2xx status", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        body: null,
        text: () => Promise.resolve("boom"),
      }) as unknown as typeof fetch;

      const service = new LlmService(makeConfig({ LLM_API_KEY: "test-key" }));

      await expect(
        service.streamReply([{ role: "user", content: "hi" }], jest.fn()),
      ).rejects.toThrow("LLM API responded with 500");
    });
  });
});
