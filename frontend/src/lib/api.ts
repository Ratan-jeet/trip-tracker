const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface RequestOptions {
  method?: string;
  body?: any;
  token?: string;
}

export async function api<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  const contentType = res.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return res.json();
  }
  return res.text() as unknown as T;
}

export const authApi = {
  register: (data: { email: string; password: string; displayName: string; phone?: string }) =>
    api('/api/auth/register', { method: 'POST', body: data }),

  login: (data: { email: string; password: string; twoFactorCode?: string }) =>
    api('/api/auth/login', { method: 'POST', body: data }),

  me: (token: string) => api('/api/auth/me', { token }),

  enable2FA: (token: string) =>
    api('/api/auth/2fa/enable', { method: 'POST', token }),

  verify2FA: (token: string, code: string) =>
    api('/api/auth/2fa/verify', { method: 'POST', body: { code }, token }),

  disable2FA: (token: string) =>
    api('/api/auth/2fa/disable', { method: 'POST', token }),
};

export const tripApi = {
  list: (token: string) => api('/api/trips', { token }),

  get: (token: string, tripId: string) => api(`/api/trips/${tripId}`, { token }),

  create: (token: string, data: { name: string; description?: string; startDate?: string; endDate?: string }) =>
    api('/api/trips', { method: 'POST', body: data, token }),

  join: (token: string, inviteCode: string) =>
    api('/api/trips/join', { method: 'POST', body: { inviteCode }, token }),

  leave: (token: string, tripId: string) =>
    api(`/api/trips/${tripId}/leave`, { method: 'POST', token }),

  delete: (token: string, tripId: string) =>
    api(`/api/trips/${tripId}`, { method: 'DELETE', token }),

  setSharing: (token: string, tripId: string, isSharing: boolean, consentLevel?: string) =>
    api(`/api/trips/${tripId}/share`, { method: 'POST', body: { isSharing, consentLevel }, token }),

  endTrip: (token: string, tripId: string) =>
    api(`/api/trips/${tripId}/end`, { method: 'POST', body: {}, token }),

  promote: (token: string, tripId: string, targetUserId: string, role: string) =>
    api(`/api/trips/${tripId}/promote`, { method: 'POST', body: { targetUserId, role }, token }),

  removeMember: (token: string, tripId: string, targetUserId: string) =>
    api(`/api/trips/${tripId}/remove-member`, { method: 'POST', body: { targetUserId }, token }),

  setRoute: (token: string, tripId: string, data: { destinationName: string; destinationLat: number; destinationLng: number; waypoints?: { lat: number; lng: number }[] }) =>
    api(`/api/trips/${tripId}/route`, { method: 'POST', body: data, token }),

  deleteRoute: (token: string, tripId: string) =>
    api(`/api/trips/${tripId}/route`, { method: 'DELETE', token }),
};

export const deviceApi = {
  register: (token: string, data: { tripId: string; deviceType: string; name: string; imei?: string }) =>
    api('/api/devices', { method: 'POST', body: data, token }),

  list: (token: string, tripId: string) => api(`/api/trips/${tripId}/devices`, { token }),

  remove: (token: string, deviceId: string) =>
    api(`/api/devices/${deviceId}`, { method: 'DELETE', token }),
};

export const locationApi = {
  update: (data: any) =>
    api('/api/location/update', { method: 'POST', body: data }),

  getLive: (token: string, tripId: string) =>
    api(`/api/trips/${tripId}/live`, { token }),

  getHistory: (token: string, tripId: string, params?: { startDate?: string; endDate?: string; deviceId?: string }) => {
    const query = new URLSearchParams(params as any).toString();
    return api(`/api/trips/${tripId}/history${query ? `?${query}` : ''}`, { token });
  },

  export: (token: string, tripId: string, format: string, params?: any) => {
    const query = new URLSearchParams({ format, ...params } as any).toString();
    return api(`/api/trips/${tripId}/export?${query}`, { token });
  },
};
