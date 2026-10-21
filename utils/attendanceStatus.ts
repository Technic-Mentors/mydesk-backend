export const isRecordedAttendanceOverride = (status?: string | null): boolean => {
  const value = status?.trim().toLowerCase() || "";
  return value === "absent" || value.startsWith("present") || value.startsWith("late");
};

export const normalizeAttendanceStatus = (status?: string | null): string => {
  const value = status?.trim().toLowerCase() || "";
  if (value.startsWith("present")) return "present";
  if (value.startsWith("late")) return "late";
  return value;
};
