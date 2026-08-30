import { create } from 'zustand';
import { authApi, tripApi, locationApi, deviceApi } from './api';

interface User {
  id: string;
  email: string;
  displayName: string;
  phone?: string;
  avatarUrl?: string;
  twoFactorEnabled: boolean;
}

interface Trip {
  id: string;
  name: string;
  description?: string;
  inviteCode: string;
  isActive: boolean;
  role: string;
  isSharing: boolean;
  consentGiven: boolean;
  memberCount: number;
}

interface TripDetail extends Trip {
  creatorId: string;
  creatorName: string;
  startDate?: string;
  endDate?: string;
  members: TripMember[];
  devices: Device[];
  memberRole: string;
}

interface TripMember {
  userId: string;
  role: string;
  isSharing: boolean;
  consentGiven: boolean;
  displayName: string;
  avatarUrl?: string;
}

interface Device {
  id: string;
  deviceType: 'phone' | 'vehicle';
  name: string;
  imei?: string;
  ownerName?: string;
}

interface LiveLocation {
  deviceId: string;
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  batteryLevel?: number;
  ignitionStatus?: boolean;
  timestamp: string;
  deviceType: string;
  deviceName: string;
  ownerName?: string;
  isStale: boolean;
}

interface AppState {
  token: string | null;
  user: User | null;
  trips: Trip[];
  currentTrip: TripDetail | null;
  liveLocations: LiveLocation[];
  isSharing: boolean;
  filter: 'all' | 'phone' | 'vehicle';
  followDeviceId: string | null;

  setToken: (token: string | null) => void;
  setUser: (user: User | null) => void;
  login: (email: string, password: string, twoFactorCode?: string) => Promise<any>;
  register: (email: string, password: string, displayName: string, phone?: string) => Promise<void>;
  logout: () => void;
  fetchMe: () => Promise<void>;
  fetchTrips: () => Promise<void>;
  fetchTrip: (tripId: string) => Promise<void>;
  createTrip: (name: string, description?: string) => Promise<Trip>;
  joinTrip: (inviteCode: string) => Promise<void>;
  toggleSharing: (tripId: string, consentLevel?: string) => Promise<void>;
  updateLiveLocations: (locations: LiveLocation[]) => void;
  addLiveLocation: (location: LiveLocation) => void;
  setFilter: (filter: 'all' | 'phone' | 'vehicle') => void;
  setFollowDevice: (deviceId: string | null) => void;
}

export const useStore = create<AppState>((set, get) => ({
  token: typeof window !== 'undefined' ? localStorage.getItem('token') : null,
  user: null,
  trips: [],
  currentTrip: null,
  liveLocations: [],
  isSharing: false,
  filter: 'all',
  followDeviceId: null,

  setToken: (token) => {
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
    set({ token });
  },

  setUser: (user) => set({ user }),

  login: async (email, password, twoFactorCode) => {
    const result = await authApi.login({ email, password, twoFactorCode });
    if (result.requiresTwoFactor) {
      return { requiresTwoFactor: true };
    }
    get().setToken(result.token);
    set({ user: result.user });
    return { success: true };
  },

  register: async (email, password, displayName, phone) => {
    const result = await authApi.register({ email, password, displayName, phone });
    get().setToken(result.token);
    set({ user: result.user });
  },

  logout: () => {
    get().setToken(null);
    set({ user: null, trips: [], currentTrip: null, liveLocations: [] });
  },

  fetchMe: async () => {
    const token = get().token;
    if (!token) return;
    try {
      const user = await authApi.me(token);
      set({ user });
    } catch {
      get().logout();
    }
  },

  fetchTrips: async () => {
    const token = get().token;
    if (!token) return;
    const trips = await tripApi.list(token);
    set({ trips });
  },

  fetchTrip: async (tripId) => {
    const token = get().token;
    if (!token) return;
    const trip = await tripApi.get(token, tripId);
    set({ currentTrip: trip, isSharing: trip.members.some(
      (m: TripMember) => m.userId === get().user?.id && m.isSharing
    )});
  },

  createTrip: async (name, description) => {
    const token = get().token;
    if (!token) throw new Error('Not authenticated');
    const trip = await tripApi.create(token, { name, description: description || undefined });
    // Auto-enable sharing for the creator
    await tripApi.setSharing(token, trip.id, true, 'always');
    await get().fetchTrips();
    return trip;
  },

  joinTrip: async (inviteCode) => {
    const token = get().token;
    if (!token) throw new Error('Not authenticated');
    await tripApi.join(token, inviteCode);
    await get().fetchTrips();
  },

  toggleSharing: async (tripId, consentLevel) => {
    const token = get().token;
    if (!token) return;
    const newSharing = !get().isSharing;
    await tripApi.setSharing(token, tripId, newSharing, consentLevel || 'while_using');
    set({ isSharing: newSharing });
    await get().fetchTrip(tripId);
  },

  updateLiveLocations: (locations) => set({ liveLocations: locations }),

  addLiveLocation: (location) => {
    const existing = get().liveLocations.filter(l => l.deviceId !== location.deviceId);
    set({ liveLocations: [...existing, location] });
  },

  setFilter: (filter) => set({ filter }),

  setFollowDevice: (deviceId) => set({ followDeviceId: deviceId }),
}));
