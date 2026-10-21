import assert from "node:assert/strict";
import { attendanceStartDate, countAttendanceWindow } from "./attendanceEligibility";

type Options = Partial<Parameters<typeof countAttendanceWindow>[0]>;

const count = (options: Options = {}) => countAttendanceWindow({
  monthStart: "2026-10-01",
  today: "2026-10-05",
  joiningDate: "2026-10-02",
  offDays: [],
  isHoliday: () => false,
  attendanceStatus: () => undefined,
  isOnApprovedLeave: () => false,
  isApprovedRemote: () => false,
  isPastLateThreshold: true,
  ...options,
});

// 1: The first day of October is outside this employee's attendance window.
assert.equal(attendanceStartDate("2026-10-01", "2026-10-02"), "2026-10-02");
assert.deepEqual(count({
  attendanceStatus: (day) => day <= "2026-10-04" ? "present" : undefined,
}), { workingDays: 4, missingDayAbsents: 1, approvedRemoteDays: 0 });

// 2: Joining on the first day keeps that day eligible for normal rules.
assert.deepEqual(count({ joiningDate: "2026-10-01", today: "2026-10-01" }),
  { workingDays: 1, missingDayAbsents: 1, approvedRemoteDays: 0 });

// 3: A midmonth join excludes every earlier day.
assert.deepEqual(count({ joiningDate: "2026-10-15", today: "2026-10-20" }),
  { workingDays: 6, missingDayAbsents: 6, approvedRemoteDays: 0 });

// 4: A join after the selected month yields no attendance or absence.
assert.deepEqual(count({ joiningDate: "2026-11-01", today: "2026-10-31" }),
  { workingDays: 0, missingDayAbsents: 0, approvedRemoteDays: 0 });

// 5: An earlier join starts at the selected month's first day.
assert.deepEqual(count({ joiningDate: "2026-09-15" }),
  { workingDays: 5, missingDayAbsents: 5, approvedRemoteDays: 0 });

// 6: Future dates and the current day before its late threshold cannot be absent.
assert.deepEqual(count({ joiningDate: "2026-10-01", isPastLateThreshold: false }),
  { workingDays: 5, missingDayAbsents: 4, approvedRemoteDays: 0 });

// 7: Off days and holidays remain excluded on either side of the join date.
assert.deepEqual(count({
  offDays: ["Saturday"],
  isHoliday: (day) => day === "2026-10-01" || day === "2026-10-04",
  attendanceStatus: (day) => day === "2026-10-02" ? "present" : undefined,
}), { workingDays: 2, missingDayAbsents: 1, approvedRemoteDays: 0 });

// 8: Approved leave and WFH days after joining do not become absences.
assert.deepEqual(count({
  attendanceStatus: (day) => day === "2026-10-02" ? "present" : undefined,
  isOnApprovedLeave: (day) => day === "2026-10-03",
  isApprovedRemote: (day) => day === "2026-10-04",
}), { workingDays: 4, missingDayAbsents: 1, approvedRemoteDays: 1 });

process.stdout.write("Attendance eligibility cases passed.\n");
