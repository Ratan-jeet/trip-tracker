let mqttClient: any = null;

export function initMQTT(onLocationUpdate: (tripId: string, deviceId: string, data: any) => void) {
  console.log('MQTT broker not configured (demo mode). Vehicle tracking disabled.');
}

export function getMQTTClient() {
  return mqttClient;
}
