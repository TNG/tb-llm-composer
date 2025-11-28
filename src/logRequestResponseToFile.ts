import type { LlmResponseBodyType } from "./llmConnection";

declare global {
  const __HTTP_LOGGING_ENABLED__: boolean;
}

export function logRequestResponseToFile(
  url: string,
  requestOptions: RequestInit,
  requestBody: object,
  response: Response,
  responseBody: LlmResponseBodyType,
) {
  const headers = { ...requestOptions.headers } as { [key: string]: string };
  headers.Authorization = "***";
  const json = {
    request: {
      url: new URL(url).pathname,
      method: requestOptions.method,
      headers: headers,
      body: requestBody,
    },
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: responseBody,
    },
  };
  const date = new Date();
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: "text/plain;charset=utf-8" });
  browser.downloads
    .download({
      url: URL.createObjectURL(blob),
      filename:
        `request-response-${date.getFullYear()}${date.getMonth() + 1}${date.getDate()}-` +
        `${date.getHours()}${date.getMinutes()}${date.getSeconds()}.json`,
    })
    .catch((e) => {
      console.warn("Failed to trigger download of request-response", e);
    });
}
