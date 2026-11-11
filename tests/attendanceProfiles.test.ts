import assert from "node:assert/strict";
import { isHalfLeaveAuthorized, resolveClockInStatus } from "../services/attendanceProfiles";

const standard = { lateTime: "09:10:00", halfLeave: "13:00:00" };
const lateShift = { lateTime: "10:10:00", halfLeave: "14:00:00" };
const lateThresholdAfterMidday = { lateTime: "17:15:00", halfLeave: "13:00:00" };

assert.equal(resolveClockInStatus("09:09:59", standard), "Present");
assert.equal(resolveClockInStatus("08:59:59", standard), "Present");
assert.equal(resolveClockInStatus("09:10:00", standard), "Late");
assert.equal(resolveClockInStatus("09:10:01", standard), "Late");
assert.equal(resolveClockInStatus("12:59:59", standard), "Late");
assert.equal(resolveClockInStatus("13:00:00", standard), "Late");
assert.equal(resolveClockInStatus("13:01:00", standard), "Late");
assert.equal(resolveClockInStatus("10:09:59", lateShift), "Present");
assert.equal(resolveClockInStatus("10:10:00", lateShift), "Late");
assert.equal(resolveClockInStatus("10:10:01", lateShift), "Late");
assert.equal(resolveClockInStatus("13:59:59", lateShift), "Late");
assert.equal(resolveClockInStatus("14:00:00", lateShift), "Late");
assert.equal(resolveClockInStatus("14:01:00", lateShift), "Late");
assert.equal(resolveClockInStatus("13:00:00", lateThresholdAfterMidday), "Present");
assert.equal(resolveClockInStatus("13:01:00", lateThresholdAfterMidday), "Present");
assert.equal(resolveClockInStatus("17:14:59", lateThresholdAfterMidday), "Present");
assert.equal(resolveClockInStatus("17:15:00", lateThresholdAfterMidday), "Late");
assert.equal(resolveClockInStatus("17:15:01", lateThresholdAfterMidday), "Late");

assert.equal(isHalfLeaveAuthorized(false, false), false);
assert.equal(isHalfLeaveAuthorized(true, false), true);
assert.equal(isHalfLeaveAuthorized(false, true), true);

console.log("Attendance profile clock-in threshold checks passed.");
