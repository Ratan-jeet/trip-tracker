/**
 * Render hands `fromService` values over as a bare host ("trip-tracker-api.onrender.com"),
 * and a relative fetch to that string resolves against the current page instead of the
 * API. Normalise once, here, so a deployment cannot be wrong in a way that only shows up
 * as a confusing CORS or 404 error in the browser.
 */
export function normaliseBaseUrl(value: string | undefined, fallback: string): string {
  const raw = (value ?? '').trim().replace(/\/+$/, '');
  if (!raw) return fallback;
  if (/^(https?|wss?):\/\//i.test(raw)) return raw;
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(raw);
  return `${isLocal ? 'http' : 'https'}://${raw}`;
}

export const API_URL = normaliseBaseUrl(process.env.NEXT_PUBLIC_API_URL, 'http://localhost:3001');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
  raw?: boolean;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, signal, raw } = options;
  const headers: Record<string, string> = {};

  // Only declare a JSON body when there is one. Sending Content-Type: application/json
  // with an empty body makes Fastify reject the request with FST_ERR_CTP_EMPTY_JSON_BODY,
  // which is what happened to every no-body POST (leave, end trip, delete route).
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${endpoint}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach the server. Check your connection.', 'NETWORK');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      payload?.error || `Request failed (${response.status})`,
      payload?.code,
      payload?.details,
    );
  }

  if (raw) return (await response.text()) as unknown as T;
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) return response.json() as Promise<T>;
  return (await response.text()) as unknown as T;
}

// ---------------------------------------------------------------------------
// Types shared with the API
// ---------------------------------------------------------------------------

export type ConsentLevel = 'once' | 'while_using' | 'always';

export interface User {
  id: string;
  email: string;
  displayName: string;
  phone?: string | null;
  avatarUrl?: string | null;
  twoFactorEnabled: boolean;
  createdAt?: string | null;
}

export interface TripSummary {
  id: string;
  name: string;
  description: string | null;
  inviteCode: string;
  isActive: boolean;
  role: 'admin' | 'member';
  isSharing: boolean;
  consentGiven: boolean;
  consentLevel: ConsentLevel | null;
  memberCount: number;
  sharingCount: number;
  createdAt: string | null;
}

export interface TripMember {
  userId: string;
  role: 'admin' | 'member';
  isSharing: boolean;
  consentGiven: boolean;
  consentLevel: ConsentLevel | null;
  displayName: string;
  avatarUrl: string | null;
  joinedAt: string | null;
  sharingStartedAt: string | null;
}

export interface Device {
  id: string;
  deviceType: 'phone' | 'vehicle';
  name: string;
  imei: string | null;
  isActive?: boolean;
  /** Identity is matched on this, never on display name. */
  ownerId: string | null;
  ownerName: string | null;
  deviceToken?: string;
}

export interface TripRoute {
  id: string;
  destinationName: string;
  destinationLat: number;
  destinationLng: number;
  waypoints: Array<{ lat: number; lng: number }>;
  createdBy: string;
}

export interface TripDetail {
  id: string;
  name: string;
  description: string | null;
  inviteCode: string;
  creatorId: string;
  creatorName: string;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  createdAt: string | null;
  memberRole: 'admin' | 'member';
  isSharing: boolean;
  consentGiven: boolean;
  consentLevel: ConsentLevel | null;
  members: TripMember[];
  devices: Device[];
  route: TripRoute | null;
}

export interface LivePosition {
  deviceId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  batteryLevel: number | null;
  ignitionStatus: boolean | null;
  timestamp: string;
  deviceType: 'phone' | 'vehicle';
  deviceName: string;
  ownerId: string | null;
  ownerName: string | null;
}

export interface HistoryPoint extends Omit<LivePosition, 'deviceName'> {
  deviceName: string;
}

export interface RoutingResult {
  available: boolean;
  distance: number | null;
  duration: number | null;
  geometry: Array<[number, number]>;
  steps: Array<{
    type: string;
    modifier: string | null;
    name: string;
    distance: number;
    duration: number;
    location: [number, number] | null;
  }>;
}

// ---------------------------------------------------------------------------

export const authApi = {
  register: (data: { email: string; password: string; displayName: string; phone?: string }) =>
    request<{ user: User; token: string }>('/api/auth/register', { method: 'POST', body: data }),

  login: (data: { email: string; password: string; twoFactorCode?: string; recoveryCode?: string }) =>
    request<{ user: User; token: string } | { requiresTwoFactor: true }>('/api/auth/login', {
      method: 'POST',
      body: data,
    }),

  me: (token: string) => request<User>('/api/auth/me', { token }),

  logoutAll: (token: string) => request<{ success: boolean }>('/api/auth/logout-all', { method: 'POST', body: {}, token }),

  enable2FA: (token: string, password: string) =>
    request<{ secret: string; otpauthUrl: string; qrCode: string }>('/api/auth/2fa/enable', {
      method: 'POST',
      body: { password },
      token,
    }),

  verify2FA: (token: string, code: string) =>
    request<{ success: boolean; recoveryCodes: string[] }>('/api/auth/2fa/verify', {
      method: 'POST',
      body: { code },
      token,
    }),

  disable2FA: (token: string, password: string, code: string) =>
    request<{ success: boolean }>('/api/auth/2fa/disable', { method: 'POST', body: { password, code }, token }),
};

export const tripApi = {
  list: (token: string) => request<TripSummary[]>('/api/trips', { token }),

  get: (token: string, tripId: string) => request<TripDetail>(`/api/trips/${tripId}`, { token }),

  create: (token: string, data: { name: string; description?: string }) =>
    request<TripSummary>('/api/trips', { method: 'POST', body: data, token }),

  join: (token: string, inviteCode: string, consentLevel: ConsentLevel, startSharing: boolean) =>
    request<{ tripId: string; tripName: string }>('/api/trips/join', {
      method: 'POST',
      body: { inviteCode, consentLevel, startSharing },
      token,
    }),

  leave: (token: string, tripId: string) =>
    request<{ success: boolean }>(`/api/trips/${tripId}/leave`, { method: 'POST', body: {}, token }),

  remove: (token: string, tripId: string) =>
    request<{ success: boolean }>(`/api/trips/${tripId}`, { method: 'DELETE', token }),

  /** Both directions. Turning sharing off used to be rejected by the API outright. */
  setSharing: (token: string, tripId: string, isSharing: boolean, consentLevel?: ConsentLevel) =>
    request<{ isSharing: boolean; consentLevel: ConsentLevel | null }>(`/api/trips/${tripId}/share`, {
      method: 'POST',
      body: { isSharing, ...(consentLevel ? { consentLevel } : {}) },
      token,
    }),

  endTrip: (token: string, tripId: string) =>
    request<{ success: boolean }>(`/api/trips/${tripId}/end`, { method: 'POST', body: {}, token }),

  promote: (token: string, tripId: string, targetUserId: string, role: 'admin' | 'member') =>
    request<{ success: boolean }>(`/api/trips/${tripId}/promote`, {
      method: 'POST',
      body: { targetUserId, role },
      token,
    }),

  removeMember: (token: string, tripId: string, targetUserId: string) =>
    request<{ success: boolean; inviteCodeRotated: boolean }>(`/api/trips/${tripId}/remove-member`, {
      method: 'POST',
      body: { targetUserId },
      token,
    }),

  rotateInviteCode: (token: string, tripId: string) =>
    request<{ inviteCode: string }>(`/api/trips/${tripId}/invite-code`, { method: 'POST', body: {}, token }),

  setRoute: (
    token: string,
    tripId: string,
    data: { destinationName: string; destinationLat: number; destinationLng: number },
  ) => request<TripRoute>(`/api/trips/${tripId}/route`, { method: 'POST', body: data, token }),

  deleteRoute: (token: string, tripId: string) =>
    request<{ success: boolean }>(`/api/trips/${tripId}/route`, { method: 'DELETE', token }),

  purgeMyData: (token: string, tripId: string) =>
    request<{ success: boolean; devicesCleared: number }>(`/api/trips/${tripId}/my-data`, {
      method: 'DELETE',
      token,
    }),
};

export const deviceApi = {
  register: (token: string, data: { tripId: string; deviceType: 'phone' | 'vehicle'; name: string; imei?: string }) =>
    request<Device>('/api/devices', { method: 'POST', body: data, token }),

  list: (token: string, tripId: string) => request<Device[]>(`/api/trips/${tripId}/devices`, { token }),

  remove: (token: string, deviceId: string) =>
    request<{ success: boolean }>(`/api/devices/${deviceId}`, { method: 'DELETE', token }),
};

export const locationApi = {
  update: (token: string, data: Record<string, unknown>) =>
    request<{ success: boolean }>('/api/location/update', { method: 'POST', body: data, token }),

  getLive: (token: string, tripId: string, signal?: AbortSignal) =>
    request<LivePosition[]>(`/api/trips/${tripId}/live`, { token, signal }),

  getHistory: (token: string, tripId: string, params: { startDate?: string; endDate?: string; deviceId?: string }) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, v]) => !!v) as Array<[string, string]>,
    ).toString();
    return request<{ points: HistoryPoint[]; truncated: boolean; limit: number }>(
      `/api/trips/${tripId}/history${query ? `?${query}` : ''}`,
      { token },
    );
  },

  export: (token: string, tripId: string, format: 'csv' | 'gpx' | 'json', params: Record<string, string>) => {
    const query = new URLSearchParams({ format, ...params }).toString();
    return request<string>(`/api/trips/${tripId}/export?${query}`, { token, raw: true });
  },

  /**
   * Routing goes through the API rather than calling the public OSRM demo server from
   * the browser, which disclosed every member's live coordinates to a third party.
   */
  route: (
    token: string,
    tripId: string,
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    withSteps: boolean,
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams({
      fromLat: String(from.lat),
      fromLng: String(from.lng),
      toLat: String(to.lat),
      toLng: String(to.lng),
      steps: String(withSteps),
    }).toString();
    return request<RoutingResult>(`/api/trips/${tripId}/routing?${query}`, { token, signal });
  },

  /** Place search, proxied so queries do not go straight from the browser to Nominatim. */
  geocode: (token: string, tripId: string, query: string, signal?: AbortSignal) =>
    request<Array<{ name: string; fullName: string; lat: number; lng: number }>>(
      `/api/trips/${tripId}/geocode?q=${encodeURIComponent(query)}`,
      { token, signal },
    ),
};
