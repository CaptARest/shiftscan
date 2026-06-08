// API helper - talks to our Vercel serverless function which connects to Neon
const BASE = '/api/db';

async function dbCall(action, params = {}) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.data || [];
}

export const db = {
  getEmployees: () => dbCall('getEmployees'),
  addEmployee: (p) => dbCall('addEmployee', p),
  updateEmployee: (p) => dbCall('updateEmployee', p),
  findByPhone: (phone) => dbCall('findByPhone', { phone }),
  getSchedules: () => dbCall('getSchedules'),
  getScheduleForEmployee: (employee_id) => dbCall('getScheduleForEmployee', { employee_id }),
  setSchedules: (employee_id, schedules) => dbCall('setSchedules', { employee_id, schedules }),
  getPunches: (start, end) => dbCall('getPunches', { start, end }),
  getTodayPunch: (employee_id, date) => dbCall('getTodayPunch', { employee_id, date }),
  addPunch: (p) => dbCall('addPunch', p),
  clockOut: (id, clock_out, effective_out) => dbCall('clockOut', { id, clock_out, effective_out }),
  updatePunch: (p) => dbCall('updatePunch', p),
};
