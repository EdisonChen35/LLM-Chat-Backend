import { ConfigService } from "@nestjs/config";

import { LlmService } from "./llm.service";

const makeConfig = (values: Record<string, string>): ConfigService => {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
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
});
