export type GeofenceRule = {
  officeLatitude?: number | string | null;
  officeLongitude?: number | string | null;
  allowedRadius?: number | string | null;
} | null;

export const validCoordinates = (latitude: unknown, longitude: unknown): boolean => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return latitude !== null && latitude !== undefined && latitude !== "" &&
    longitude !== null && longitude !== undefined && longitude !== "" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
};

export const assessGeofence = (latitude: number, longitude: number, rule: GeofenceRule) => {
  const configured = validCoordinates(rule?.officeLatitude, rule?.officeLongitude);
  const configuredRadius = Number(rule?.allowedRadius);
  const allowedRadius = Number.isFinite(configuredRadius) && configuredRadius > 0
    ? configuredRadius : 100;

  if (!configured) {
    return { configured: false, distanceMeters: null, allowedRadius, withinRange: false };
  }

  const officeLatitude = Number(rule?.officeLatitude);
  const officeLongitude = Number(rule?.officeLongitude);
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(officeLatitude - latitude);
  const longitudeDelta = toRadians(officeLongitude - longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(latitude)) * Math.cos(toRadians(officeLatitude)) *
    Math.sin(longitudeDelta / 2) ** 2;
  const distanceMeters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  // GPS accuracy is shown to the user, but it does not extend the office radius.
  return { configured: true, distanceMeters, allowedRadius, withinRange: distanceMeters <= allowedRadius };
};
