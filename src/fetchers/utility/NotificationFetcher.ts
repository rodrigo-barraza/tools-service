import { fetchPublicUrl } from "../web/SsrfGuard.ts";

// ─── Push Notification (ntfy.sh) ───────────────────────────────────

interface PushNotificationOptions {
  topic: string;
  message: string;
  title?: string;
  priority?: "min" | "low" | "default" | "high" | "urgent";
  tags?: string[];
  clickUrl?: string;
  attachmentUrl?: string;
}

interface PushNotificationResult {
  success: boolean;
  id: string;
  topic: string;
  message: string;
  time: number;
}

export async function sendPushNotification(
  options: PushNotificationOptions,
  baseUrl: string = "https://ntfy.sh",
  authToken?: string,
): Promise<PushNotificationResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const requestBody: Record<string, unknown> = {
    topic: options.topic,
    message: options.message,
  };

  if (options.title) requestBody.title = options.title;
  if (options.priority) requestBody.priority = options.priority;
  if (options.tags) requestBody.tags = options.tags;
  if (options.clickUrl) requestBody.click = options.clickUrl;
  if (options.attachmentUrl) requestBody.attach = options.attachmentUrl;

  const response = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `ntfy returned status ${response.status}: ${errorBody}`,
    );
  }

  const responseData = (await response.json()) as PushNotificationResult;
  return {
    success: true,
    id: responseData.id,
    topic: responseData.topic,
    message: responseData.message,
    time: responseData.time,
  };
}

// ─── Generic Webhook Sender ────────────────────────────────────────

interface WebhookOptions {
  url: string;
  payload: unknown;
  method?: "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
}

interface WebhookResult {
  success: boolean;
  statusCode: number;
  statusText: string;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  responseTimeMs: number;
}

export async function sendWebhook(
  options: WebhookOptions,
): Promise<WebhookResult> {
  const method = options.method || "POST";
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  const requestStartTime = Date.now();
  // Public addresses only, checked as each hop connects (SsrfGuard)
  const response = await fetchPublicUrl(options.url, {
    method,
    headers: requestHeaders,
    body: JSON.stringify(options.payload),
    signal: AbortSignal.timeout(30_000),
  });
  const responseTimeMs = Date.now() - requestStartTime;

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((headerValue, headerName) => {
    responseHeaders[headerName] = headerValue;
  });

  let responseBody: unknown;
  const responseContentType = response.headers.get("content-type") || "";
  if (responseContentType.includes("application/json")) {
    try {
      responseBody = await response.json();
    } catch {
      responseBody = await response.text();
    }
  } else {
    const textBody = await response.text();
    responseBody = textBody.slice(0, 5000);
  }

  return {
    success: response.ok,
    statusCode: response.status,
    statusText: response.statusText,
    responseHeaders,
    responseBody,
    responseTimeMs,
  };
}
