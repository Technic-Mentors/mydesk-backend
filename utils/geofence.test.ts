import assert from "node:assert/strict";
import { assessGeofence, validCoordinates } from "./geofence";

const rule = { officeLatitude: 0, officeLongitude: 0, allowedRadius: 100 };
const latitudeAtMeters = (meters: number) => meters / 6371000 * 180 / Math.PI;

assert.equal(assessGeofence(0, 0, rule).withinRange, true);
assert.equal(assessGeofence(latitudeAtMeters(99), 0, rule).withinRange, true);
assert.equal(assessGeofence(latitudeAtMeters(100), 0, rule).withinRange, true);
assert.equal(assessGeofence(latitudeAtMeters(101), 0, rule).withinRange, false);
assert.equal(assessGeofence(latitudeAtMeters(101), 0, rule).distanceMeters! > 100, true);
assert.equal(assessGeofence(0, 0, { ...rule, allowedRadius: "100" }).allowedRadius, 100);
assert.equal(assessGeofence(0, 0, null).configured, false);
assert.equal(validCoordinates(0, 0), true);
assert.equal(validCoordinates("not-a-coordinate", 0), false);

process.stdout.write("Geofence boundary cases passed.\n");
