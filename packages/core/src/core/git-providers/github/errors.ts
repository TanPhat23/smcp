import { isAxiosError } from "axios";

export function extractErrorDetail(body: unknown): string {
  if (typeof body === "string") {
    const trimmed = body.trim();
    return trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
  }

  if (body && typeof body === "object") {
    const { message, errors } = body as { message?: string; errors?: unknown };
    const errList = Array.isArray(errors)
      ? errors
          .map((e) =>
            typeof e === "object" && e
              ? (e as any).message ||
                ((e as any).field && (e as any).code
                  ? `${(e as any).field} (${(e as any).code})`
                  : JSON.stringify(e))
              : String(e)
          )
          .join(", ")
      : errors
      ? String(errors)
      : "";

    return [message?.trim(), errList].filter(Boolean).join(" - ");
  }

  return "";
}

export async function parseResponseBody(
  target: unknown
): Promise<{ status?: number; statusText?: string; data?: unknown }> {
  if (isAxiosError(target) && target.response) {
    return {
      status: target.response.status,
      statusText: target.response.statusText,
      data: target.response.data
    };
  }

  if (target && typeof target === "object" && "status" in target) {
    const res = target as Response;
    let data: unknown;
    if (typeof res.text === "function") {
      try {
        const text = await res.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      } catch {
        // Response body could not be read
      }
    } else if ("data" in (res as any)) {
      data = (res as any).data;
    }
    return { status: res.status, statusText: res.statusText, data };
  }

  return {};
}

export async function formatApiError(errOrRes: unknown, defaultMsg: string): Promise<string> {
  if (errOrRes instanceof Error && !isAxiosError(errOrRes)) {
    return `${defaultMsg}: ${errOrRes.message}`;
  }

  if (typeof errOrRes === "string") {
    return `${defaultMsg}: ${errOrRes}`;
  }

  if (errOrRes === null || errOrRes === undefined || typeof errOrRes !== "object") {
    return `${defaultMsg}: ${String(errOrRes)}`;
  }

  const { status, statusText = "", data } = await parseResponseBody(errOrRes);
  let detail = extractErrorDetail(data) || statusText;
  if (!detail && isAxiosError(errOrRes)) {
    detail = errOrRes.message;
  }

  let hint = "";
  if (isAxiosError(errOrRes) && errOrRes.response) {
    const scopes = errOrRes.response.headers?.["x-oauth-scopes"];
    const accepted = errOrRes.response.headers?.["x-accepted-oauth-scopes"];
    if (accepted && scopes && typeof scopes === "string" && !scopes.includes("repo")) {
      hint = ` (Current token scopes: [${scopes}], required: [${accepted}]. Add 'repo' scope at https://github.com/settings/tokens/new?scopes=gist,repo&description=smcp-cli)`;
    }
  }

  const category =
    status === 401 || status === 403
      ? "Auth failed"
      : status !== undefined && status >= 500 && status < 600
      ? "GitHub service unavailable"
      : "";

  const info = [category, detail].filter(Boolean).join(": ") || "Unknown error";
  return `${defaultMsg}: ${status ?? "Error"} ${info}${hint}`;
}
