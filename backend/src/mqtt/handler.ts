// Vehicle tracker ingest over MQTT.
//
// This was previously a stub that logged "not configured" and returned, while the README
// advertised dual phone + vehicle tracking as a headline feature and the `mqtt` package
// was not even a dependency. Trackers now have a supported path that does not require a
// broker: they POST to /api/location/update with the device token issued at registration.
//
//   curl -X POST https://your-api/api/location/update \
//     -H 'Content-Type: application/json' \
//     -H 'X-Device-Token: <token returned when the vehicle device was registered>' \
//     -d '{"tripId":"...","deviceId":"...","lat":15.5,"lng":73.8,"speed":16.6}'
//
// To bridge a broker instead, subscribe to device/{IMEI}/location and call the same
// endpoint per message. Left unimplemented rather than pretending: wiring it up means
// choosing a broker, an auth model and an IMEI-to-device mapping, none of which existed.

export interface VehicleLocationBridge {
  stop: () => Promise<void>;
}

export function initMQTT(): VehicleLocationBridge | null {
  console.log('[mqtt] broker bridge not enabled — trackers report over HTTP with a device token.');
  return null;
}
