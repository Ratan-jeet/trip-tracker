const liveLocations = new Map<string, Map<string, any>>();

export async function setLiveLocation(tripId: string, deviceId: string, data: any) {
  if (!liveLocations.has(tripId)) {
    liveLocations.set(tripId, new Map());
  }
  liveLocations.get(tripId)!.set(deviceId, { ...data, updatedAt: Date.now() });
}

export async function getLiveLocations(tripId: string) {
  const trip = liveLocations.get(tripId);
  if (!trip) return [];
  return Array.from(trip.entries()).map(([deviceId, data]) => ({ deviceId, ...data }));
}

export async function removeLiveLocation(tripId: string, deviceId: string) {
  liveLocations.get(tripId)?.delete(deviceId);
}
