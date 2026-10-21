import moment from "moment-timezone";
import { isRecordedAttendanceOverride } from "./attendanceStatus";

const TIME_ZONE = "Asia/Karachi";

export const attendanceStartDate = (monthStart: string, joiningDate: string): string =>
  joiningDate > monthStart ? joiningDate : monthStart;

type AttendanceWindow = {
  monthStart: string;
  today: string;
  joiningDate: string;
  offDays: string[];
  isHoliday: (day: string) => boolean;
  attendanceStatus: (day: string) => string | undefined;
  isOnApprovedLeave: (day: string) => boolean;
  isApprovedRemote: (day: string) => boolean;
  isPastLateThreshold: boolean;
};

export const countAttendanceWindow = ({
  monthStart,
  today,
  joiningDate,
  offDays,
  isHoliday,
  attendanceStatus,
  isOnApprovedLeave,
  isApprovedRemote,
  isPastLateThreshold,
}: AttendanceWindow): { workingDays: number; missingDayAbsents: number; approvedRemoteDays: number } => {
  const start = attendanceStartDate(monthStart, joiningDate);
  let workingDays = 0;
  let missingDayAbsents = 0;
  let approvedRemoteDays = 0;

  for (const day = moment.tz(start, "YYYY-MM-DD", TIME_ZONE);
    day.format("YYYY-MM-DD") <= today;
    day.add(1, "day")) {
    const dayStr = day.format("YYYY-MM-DD");
    if (offDays.includes(day.format("dddd")) || isHoliday(dayStr)) continue;

    workingDays++;
    const status = attendanceStatus(dayStr);
    if (isOnApprovedLeave(dayStr) && !isRecordedAttendanceOverride(status)) continue;
    if (isApprovedRemote(dayStr)) {
      if (!status) approvedRemoteDays++;
      continue;
    }
    if (status) continue;
    if (dayStr === today && !isPastLateThreshold) continue;
    missingDayAbsents++;
  }

  return { workingDays, missingDayAbsents, approvedRemoteDays };
};
