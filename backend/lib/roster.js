'use strict';

const path = require('path');
const { createCsvStore } = require('./csvStore');

const STAFF_HEADERS = ['id', 'name', 'role', 'hourly_rate', 'phone'];
const STAFF_NUMERIC = ['id', 'hourly_rate'];

const SHIFT_HEADERS = ['shift_id', 'staff_id', 'name', 'role', 'date', 'start_time', 'end_time', 'status'];
const SHIFT_NUMERIC = ['shift_id', 'staff_id'];

const staffStore = createCsvStore({
  filePath: path.join(__dirname, '..', 'data', 'staff.csv'),
  headers: STAFF_HEADERS,
  numericFields: STAFF_NUMERIC,
  idField: 'id',
});

const shiftStore = createCsvStore({
  filePath: path.join(__dirname, '..', 'data', 'roster.csv'),
  headers: SHIFT_HEADERS,
  numericFields: SHIFT_NUMERIC,
  idField: 'shift_id',
});

function getStaff() {
  return staffStore.all();
}

function addStaff(data) {
  return staffStore.add({
    name: data.name || '',
    role: data.role || '',
    hourly_rate: Number(data.hourly_rate) || 0,
    phone: data.phone || '',
  });
}

function getShifts(date) {
  const rows = shiftStore.all();
  return date ? rows.filter((s) => s.date === date) : rows;
}

function addShift(data) {
  const staff = staffStore.find(data.staff_id);
  if (!staff) throw new Error('Staff member not found');
  return shiftStore.add(
    {
      staff_id: staff.id,
      name: staff.name,
      role: data.role || staff.role,
      date: data.date,
      start_time: data.start_time,
      end_time: data.end_time,
    },
    { status: 'scheduled' }
  );
}

function setShiftStatus(shiftId, status) {
  return shiftStore.update(shiftId, { status });
}

/**
 * Who's rostered on right now, based on today's date + current time
 * falling inside [start_time, end_time). Simple string comparison works
 * because both are zero-padded HH:MM.
 */
function getOnShiftNow(nowDate = new Date()) {
  const today = nowDate.toISOString().slice(0, 10);
  const hhmm = nowDate.toTimeString().slice(0, 5);
  return shiftStore
    .all()
    .filter((s) => s.date === today && s.start_time <= hhmm && hhmm < s.end_time && s.status !== 'cancelled');
}

module.exports = { getStaff, addStaff, getShifts, addShift, setShiftStatus, getOnShiftNow };
