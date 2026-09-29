import axios, {
  type AxiosAdapter,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  isAxiosError
} from "axios";

export const DEFAULT_HTTP_TIMEOUT_MS = 15000;

let globalHttpAdapter: AxiosAdapter | undefined = undefined;

const axiosInstanceCache = new Map<string, AxiosInstance>();

const adapterIds = new WeakMap<AxiosAdapter, number>();
let nextAdapterId = 1;

function getAdapterId(adapter?: AxiosAdapter): number | string {
  if (!adapter) return "none";
  if (typeof adapter !== "function" && typeof adapter !== "object") {
    return String(adapter);
  }
  let id = adapterIds.get(adapter);
  if (!id) {
    id = nextAdapterId++;
    adapterIds.set(adapter, id);
  }
  return id;
}

const validateStatusIds = new WeakMap<Function, number>();
let nextValidateStatusId = 1;

function getValidateStatusId(fn?: Function): number | string {
  if (!fn) return "none";
  if (typeof fn !== "function" && typeof fn !== "object") {
    return String(fn);
  }
  let id = validateStatusIds.get(fn);
  if (!id) {
    id = nextValidateStatusId++;
    validateStatusIds.set(fn, id);
  }
  return id;
}

export function clearHttpClientCache(): void {
  axiosInstanceCache.clear();
}

export function setDefaultHttpAdapter(adapter: AxiosAdapter | undefined): void {
  globalHttpAdapter = adapter;
  clearHttpClientCache();
}

export interface HttpClientOptions {
  baseURL?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  adapter?: AxiosAdapter;
  validateStatus?: (status: number) => boolean;
  axiosInstance?: AxiosInstance;
}

function computeCacheKey(
  baseURL: string | undefined,
  timeoutMs: number,
  adapter: AxiosAdapter | undefined,
  headers: Record<string, string>,
  validateStatus: ((status: number) => boolean) | undefined
): string {
  const headerEntries = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}`)
    .join("|");

  return JSON.stringify([
    baseURL ?? "",
    timeoutMs,
    getAdapterId(adapter),
    headerEntries,
    getValidateStatusId(validateStatus)
  ]);
}

export function getOrCreateAxiosInstance(options?: HttpClientOptions): AxiosInstance {
  if (options?.axiosInstance) {
    return options.axiosInstance;
  }

  const baseURL = options?.baseURL;
  const timeout = options?.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const adapter = options?.adapter ?? globalHttpAdapter;
  const headers: Record<string, string> = {
    "User-Agent": "smcp-cli",
    ...(options?.headers || {})
  };
  const validateStatus = options?.validateStatus;

  const key = computeCacheKey(baseURL, timeout, adapter, headers, validateStatus);
  const cached = axiosInstanceCache.get(key);
  if (cached) {
    return cached;
  }

  const instance = axios.create({
    baseURL,
    timeout,
    adapter,
    headers,
    validateStatus
  });

  axiosInstanceCache.set(key, instance);
  return instance;
}

export class HttpClient {
  #client: AxiosInstance;

  constructor(options?: HttpClientOptions) {
    this.#client = getOrCreateAxiosInstance(options);
  }

  get raw(): AxiosInstance {
    return this.#client;
  }

  get interceptors() {
    return this.#client.interceptors;
  }

  async request<T = unknown>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.#client.request<T>(config);
  }

  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.#client.get<T>(url, config);
  }

  async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.#client.post<T>(url, data, config);
  }

  async put<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.#client.put<T>(url, data, config);
  }

  async patch<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.#client.patch<T>(url, data, config);
  }

  async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.#client.delete<T>(url, config);
  }

  async fetchJson<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const res = await this.get<T>(url, {
      ...config,
      headers: {
        Accept: "application/json, text/plain, */*",
        ...(config?.headers || {})
      }
    });
    return res.data;
  }

  async fetchText(url: string, config?: AxiosRequestConfig): Promise<string> {
    const res = await this.get<string>(url, {
      ...config,
      responseType: "text",
      headers: {
        Accept: "text/plain, text/markdown, */*",
        ...(config?.headers || {})
      }
    });
    return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  }
}

export function createHttpClient(options?: HttpClientOptions): HttpClient {
  return new HttpClient(options);
}

export function formatHttpError(err: unknown, fallbackMessage = "HTTP Request failed"): string {
  if (isAxiosError(err)) {
    const status = err.response?.status;
    const statusText = err.response?.statusText;
    const data = err.response?.data;

    let detail = "";
    if (data && typeof data === "object") {
      if ("message" in data && typeof (data as any).message === "string") {
        detail = (data as any).message;
      } else {
        detail = JSON.stringify(data);
      }
    } else if (typeof data === "string") {
      const trimmed = data.trim();
      detail = trimmed.length > 200 ? trimmed.slice(0, 200) + "..." : trimmed;
    } else if (err.message) {
      detail = err.message;
    }

    const segments: string[] = [];
    if (status) segments.push(String(status));
    if (statusText) segments.push(statusText);
    if (detail) segments.push(detail);

    return segments.length > 0 ? `${fallbackMessage}: ${segments.join(" ")}` : fallbackMessage;
  }

  if (err instanceof Error) {
    return `${fallbackMessage}: ${err.message}`;
  }

  return `${fallbackMessage}: ${String(err)}`;
}
