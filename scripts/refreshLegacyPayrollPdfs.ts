import pool from "../database/db";
(async()=>{
  console.log("Payslips are generated only for email delivery. No stored PDF refresh is needed.");
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
