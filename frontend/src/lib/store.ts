'use client';

import { create } from 'zustand';
import {
  ApiError,
  authApi,
  deviceApi,
  locationApi,
  tripApi,
  type ConsentLevel,
  type Device,
  type LivePosition,
  type TripDetail,
  type TripSummary,
  type User,
} from './api';

const TOKEN_KEY = 'trip-tracker.token';

function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

interface AppState {
  token: string | null;
  user: User | null;
  hydrated: boolean;

  trips: TripSummary[];
  currentTrip: TripDetail | null;
  liveLocations: LivePosition[];
  myDevice: Device | null;

  filter: 'all' | 'phone' | 'vehicle';
  followDeviceId: string | null;

  setToken: (token: string | null) => void;
  hydrate: () => Promise<void>;
  login: (email: string, password: string, code?: { twoFactorCode?: string; recoveryCode?: string }) => Promise<boolean>;
  register: (email: string, password: string, displayName: string, phone?: string) => Promise<void>;
  logout: () => void;

  fetchTrips: () => Promise<void>;
  fetchTrip: (tripId: string) => Promise<void>;
  createTrip: (name: string, description?: string) => Promise<TripSummary>;
  joinTrip: (inviteCode: string, consentLevel: ConsentLevel, startSharing: boolean) => Promise<void>;

  setSharing: (tripId: string, isSharing: boolean, consentLevel?: ConsentLevel) => Promise<void>;
  setMyDevice: (device: Device | null) => void;

  replaceLocations: (locations: LivePosition[]) => void;
  upsertLocation: (location: LivePosition) => void;
  dropDevices: (deviceIds: string[]) => void;

  setFilter: (filter: 'all' | 'phone' | 'vehicle') => void;
  setFollowDevice: (deviceId: string | null) => void;
  setRoute: (route: TripDetail['route']) => void;
}

export const useStore = create<AppState>((set, get) => ({
  // Reading localStorage during module init causes a hydration mismatch in the app
  // router; the value is loaded in `hydrate()` from an effect instead.
  token: null,
  user: null,
  hydrated: false,

  trips: [],
  currentTrip: null,
  liveLocations: [],
  myDevice: null,

  filter: 'all',
  followDeviceId: null,

  setToken: (token) => {
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private browsing — the session simply will not persist */
    }
    set({ token });
  },

  hydrate: async () => {
    const token = readToken();
    if (!token) {
      set({ hydrated: true });
      return;
    }
    set({ token });
    try {
      set({ user: await authApi.me(token), hydrated: true });
    } catch {
      get().logout();
      set({ hydrated: true });
    }
  },

  login: async (email, password, code) => {
    const result = await authApi.login({ email, password, ...code });
    if ('requiresTwoFactor' in result) return false;
    get().setToken(result.token);
    set({ user: result.user });
    return true;
  },

  register: async (email, password, displayName, phone) => {
    const result = await authApi.register({ email, password, displayName, phone });
    get().setToken(result.token);
    set({ user: result.user });
  },

  logout: () => {
    get().setToken(null);
    set({ user: null, trips: [], currentTrip: null, liveLocations: [], myDevice: null, followDeviceId: null });
  },

  fetchTrips: async () => {
    const { token } = get();
    if (!token) return;
    set({ trips: await tripApi.list(token) });
  },

  fetchTrip: async (tripId) => {
    const { token } = get();
    if (!token) return;
    const trip = await tripApi.get(token, tripId);
    set({ currentTrip: trip });
  },

  createTrip: async (name, description) => {
    const { token } = get();
    if (!token) throw new ApiError(401, 'Not signed in');
    // Sharing is no longer switched on behind the creator's back; they opt in on the
    // trip screen like everyone else.
    const trip = await tripApi.create(token, { name, description });
    await get().fetchTrips();
    return trip;
  },

  joinTrip: async (inviteCode, consentLevel, startSharing) => {
    const { token } = get();
    if (!token) throw new ApiError(401, 'Not signed in');
    await tripApi.join(token, inviteCode, consentLevel, startSharing);
    await get().fetchTrips();
  },

  setSharing: async (tripId, isSharing, consentLevel) => {
    const { token, currentTrip, user } = get();
    if (!token) return;
    await tripApi.setSharing(token, tripId, isSharing, consentLevel);

    // Reflect it immediately; the trip refetch below confirms it.
    if (currentTrip?.id === tripId && user) {
      set({
        currentTrip: {
          ...currentTrip,
          isSharing,
          consentGiven: isSharing,
          consentLevel: isSharing ? consentLevel ?? currentTrip.consentLevel : null,
          members: currentTrip.members.map((m) =>
            m.userId === user.id ? { ...m, isSharing, consentGiven: isSharing } : m,
          ),
        },
      });
    }
    if (!isSharing) {
      const myDeviceId = get().myDevice?.id;
      if (myDeviceId) get().dropDevices([myDeviceId]);
    }
    await Promise.all([get().fetchTrip(tripId), get().fetchTrips()]);
  },

  setMyDevice: (device) => set({ myDevice: device }),

  // The poll used to skip empty responses (`if (locations.length > 0)`), so markers for
  // members who stopped sharing stayed on the map forever.
  replaceLocations: (locations) => set({ liveLocations: locations }),

  upsertLocation: (location) =>
    set((state) => {
      const index = state.liveLocations.findIndex((l) => l.deviceId === location.deviceId);
      if (index === -1) return { liveLocations: [...state.liveLocations, location] };
      const next = state.liveLocations.slice();
      next[index] = { ...next[index], ...location };
      return { liveLocations: next };
    }),

  dropDevices: (deviceIds) =>
    set((state) => ({
      liveLocations: state.liveLocations.filter((l) => !deviceIds.includes(l.deviceId)),
      followDeviceId: deviceIds.includes(state.followDeviceId ?? '') ? null : state.followDeviceId,
    })),

  setFilter: (filter) => set({ filter }),
  setFollowDevice: (deviceId) => set({ followDeviceId: deviceId }),
  setRoute: (route) =>
    set((state) => ({ currentTrip: state.currentTrip ? { ...state.currentTrip, route } : null })),
}));

export { deviceApi, locationApi, tripApi };
