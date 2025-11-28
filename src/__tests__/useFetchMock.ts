import { expect, vi } from "vitest";

// default mock url and token used in mockResponses
export const MOCK_MODEL_URL = "https://someLLM.com/v1/chat/completions";
export const MOCK_TOKEN = "testToken";

interface MockRequest {
  url: string;
  method: "GET" | "POST";
  headers: { [key: string]: string };
  body: unknown;
}

interface MockResponse {
  status: number;
  statusText: string;
  headers: { [key: string]: string };
  body: unknown;
}

interface MockRequestResponse {
  request: MockRequest;
  response: MockResponse;
}

export function useFetchMock(...mocks: string[]) {
  // @ts-ignore
  const modules = import.meta.glob("./mockResponses/*.json", { eager: true }) as { [key: string]: MockRequestResponse };
  const requestResponses = Object.fromEntries(mocks.map((mock) => [mock, modules[`./mockResponses/${mock}`]]));

  async function fetchMock(input: string, init?: RequestInit) {
    console.log(`FETCH-MOCK: Received request to mocked fetch method (url: ${input})`);
    for (const [mockName, requestResponse] of Object.entries(requestResponses)) {
      if (await isRequestMatchingExpected(input, init || {}, requestResponse.request, mockName)) {
        return new Response(JSON.stringify(requestResponse.response.body), {
          status: requestResponse.response.status,
          statusText: requestResponse.response.statusText,
          headers: requestResponse.response.headers,
        });
      }
    }
    throw new Error(`FETCH-MOCK: No request mock matched request ${input} (opts: ${JSON.stringify(init)}`);
  }

  global.fetch = vi.fn().mockImplementation(fetchMock);
}

export function useFetchWithAbort(timeoutMs: number) {
  async function fetchMock(input: string, init?: RequestInit) {
    console.log(`FETCH-MOCK: Received request to mocked fetch method for abort testing (url: ${input})`);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (init?.signal?.aborted) {
        throw init.signal.reason;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("FETCH-MOCK: test error, should never be returned, this request should be aborted");
  }

  global.fetch = vi.fn().mockImplementation(fetchMock);
}

async function isRequestMatchingExpected(
  url: string,
  requestInit: RequestInit,
  expected: MockRequest,
  mockName: string,
) {
  console.log(
    `FETCH-MOCK: Checking incoming request ${url} ${JSON.stringify(requestInit)} against expected ${JSON.stringify(expected)}`,
  );
  try {
    const requestUrl = new URL(url);
    expect(`${requestInit.method} ${requestUrl.pathname}`).toBe(`${expected.method} ${expected.url}`);
    console.log("FETCH-MOCK:   Paths match");
    const requestHeaders = (requestInit.headers || {}) as { [key: string]: string };
    expect(requestHeaders).toEqual(expect.objectContaining(expected.headers));
    console.log("FETCH-MOCK:   Headers match");
    const parse = JSON.parse(requestInit.body as string);
    expect(parse, `Request bodies did not match. Received: ${requestInit.body}`).toStrictEqual(expected.body);
    console.log("FETCH-MOCK:   Bodies match");
    return true;
  } catch (e) {
    console.log(`FETCH-MOCK:   Request did not match expectation '${mockName}' because ${e}`);
    return false;
  }
}
