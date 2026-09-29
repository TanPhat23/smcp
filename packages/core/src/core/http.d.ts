import { type AxiosAdapter, type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from "axios";
export declare const DEFAULT_HTTP_TIMEOUT_MS = 15000;
export declare function clearHttpClientCache(): void;
export declare function setDefaultHttpAdapter(adapter: AxiosAdapter | undefined): void;
export interface HttpClientOptions {
    baseURL?: string;
    timeoutMs?: number;
    headers?: Record<string, string>;
    adapter?: AxiosAdapter;
    validateStatus?: (status: number) => boolean;
    axiosInstance?: AxiosInstance;
}
export declare function getOrCreateAxiosInstance(options?: HttpClientOptions): AxiosInstance;
export declare class HttpClient {
    #private;
    constructor(options?: HttpClientOptions);
    get raw(): AxiosInstance;
    get interceptors(): {
        request: import("axios").AxiosInterceptorManager<import("axios").InternalAxiosRequestConfig>;
        response: import("axios").AxiosInterceptorManager<AxiosResponse>;
    };
    request<T = unknown>(config: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    fetchJson<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>;
    fetchText(url: string, config?: AxiosRequestConfig): Promise<string>;
}
export declare function createHttpClient(options?: HttpClientOptions): HttpClient;
export declare function formatHttpError(err: unknown, fallbackMessage?: string): string;
