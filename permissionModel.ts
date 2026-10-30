export type Principal = {
  role?: string | null;
  permissions?: readonly string[] | null;
};

// Names match the modules.moduleName values stored by access_control.
export const MODULE = {
  Dashboard: "Dashboard",
  People: "People",
  HumanResources: "Human Resources",
  Attendance: "Attendance",
  Configuration: "Configuration",
  Projects: "Projects",
  Performance: "Performance",
  LeadManagement: "Lead Management",
  Pipeline: "Pipeline",
  FollowUps: "Follow-ups",
  Sales: "Sales",
  Accounts: "Accounts",
  Payroll: "Payroll",
  Expenses: "Expenses",
  Assets: "Assets",
  TalentAcquisition: "Talent Acquisition",
  Dynamics: "Dynamics",
  UsersManagement: "Users Management",
  Reports: "Reports",
  Chat: "Chat",
} as const;

export const isAdministrator = (user: Principal | null | undefined) =>
  user?.role?.toLowerCase() === "admin";

export const isEmployee = (user: Principal | null | undefined) =>
  user?.role?.toLowerCase() === "user";

export const hasPermission = (user: Principal | null | undefined, module: string) =>
  !!user && (isAdministrator(user) || (!isEmployee(user) && !!user.permissions?.includes(module)));
