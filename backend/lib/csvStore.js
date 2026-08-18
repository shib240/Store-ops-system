'use strict';

const fs = require('fs');
const { parseCSV, toCSV } = require('./csv');

/**
 * Factory for a simple CSV-backed entity store.
 * Every module (products, sales, staff, roster, click&collect) is just
 * a different set of headers/numeric fields over the same read-all,
 * mutate-in-memory, write-through pattern.
 */
function createCsvStore({ filePath, headers, numericFields = [], idField }) {
  function coerce(row) {
    const out = { ...row };
    for (const f of numericFields) {
      if (out[f] !== undefined && out[f] !== '') out[f] = Number(out[f]);
    }
    return out;
  }

  function load() {
    const text = fs.readFileSync(filePath, 'utf8');
    const { rows } = parseCSV(text);
    return rows.map(coerce);
  }

  function persist(rows) {
    fs.writeFileSync(filePath, toCSV(headers, rows));
  }

  let rows = load();

  function nextId() {
    return rows.reduce((max, r) => Math.max(max, Number(r[idField]) || 0), 0) + 1;
  }

  return {
    all: () => rows,
    find: (id) => rows.find((r) => r[idField] === Number(id)),
    where: (predicate) => rows.filter(predicate),
    add: (data, extra = {}) => {
      const record = { [idField]: nextId(), ...data, ...extra };
      numericFields.forEach((f) => {
        if (record[f] !== undefined) record[f] = Number(record[f]);
      });
      rows.push(record);
      persist(rows);
      return record;
    },
    addRaw: (record) => {
      rows.push(record);
      persist(rows);
      return record;
    },
    update: (id, patch) => {
      const idx = rows.findIndex((r) => r[idField] === Number(id));
      if (idx === -1) return null;
      const merged = { ...rows[idx], ...patch, [idField]: rows[idx][idField] };
      numericFields.forEach((f) => {
        if (merged[f] !== undefined) merged[f] = Number(merged[f]);
      });
      rows[idx] = merged;
      persist(rows);
      return merged;
    },
    remove: (id) => {
      const before = rows.length;
      rows = rows.filter((r) => r[idField] !== Number(id));
      persist(rows);
      return rows.length < before;
    },
    reload: () => {
      rows = load();
    },
  };
}

module.exports = { createCsvStore };
