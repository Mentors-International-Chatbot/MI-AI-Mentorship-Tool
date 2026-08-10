export function playerHeaders(json = false): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  if (typeof window !== "undefined") {
    const token = window.sessionStorage.getItem("oci_lti_token");
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function playerFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...playerHeaders(!!init?.body), ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error ?? "Request failed") as Error & { status?: number; code?: string };
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data as T;
}
