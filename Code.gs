const APP_TITLE = 'SimTeacher V2 Risk-Based Audit Task Picker';
const HISTORY_KEY = 'simteacher_v2_audit_history';
const CONFIG_KEY = 'simteacher_v2_saved_config';

const REQUIRED_POPULATION_COLUMNS = [
  'imerit_task_id',
  'qc_replay_link',
  'batch_id',
  'simteacher_v2_labeler',
  'v2_end_date_ist',
  'selectQcResult',
  'failureReason',
  'qc_confidence'
];

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(APP_TITLE)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getSavedConfiguration() {
  const props = PropertiesService.getUserProperties();
  const raw = props.getProperty(CONFIG_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveConfiguration(config) {
  PropertiesService.getUserProperties().setProperty(CONFIG_KEY, JSON.stringify(config || {}));
  return { ok: true };
}

function getAuditSelectionHistory() {
  const raw = PropertiesService.getUserProperties().getProperty(HISTORY_KEY);
  return raw ? JSON.parse(raw) : [];
}

function clearAuditSelectionHistory() {
  PropertiesService.getUserProperties().deleteProperty(HISTORY_KEY);
  return { ok: true };
}

function processAuditSelection(payload) {
  const startedAt = new Date();
  validatePayload(payload);

  const historicalRows = parseCsvObjectRows(payload.historicalCsv, 'Historical Performance CSV');
  const populationRows = parseCsvObjectRows(payload.populationCsv, 'Audit Population CSV');
  validatePopulationColumns(populationRows.headers);

  const config = normalizeConfig(payload.config);
  const historicalLookup = buildHistoricalLookup(historicalRows.rows);
  const enrichedRows = enrichPopulation(populationRows.rows, historicalLookup);
  const capacity = calculateTlCapacity(config.tls, config.minutesPerTask);
  const selected = selectAuditTasks(enrichedRows, capacity.totalCapacity, config.seed);
  const assigned = assignTls(selected, capacity.tls);
  const summary = buildDashboardSummary(enrichedRows, assigned, capacity, startedAt, config);

  appendAuditHistory(summary, assigned);
  saveConfiguration(config);

  return {
    appTitle: APP_TITLE,
    generatedAt: startedAt.toISOString(),
    seed: String(config.seed || ''),
    summary,
    selectedRows: assigned,
    exports: {
      csv: toCsv(assigned.map(toOutputRow)),
      excelHtml: toExcelHtml(assigned.map(toOutputRow), summary)
    }
  };
}

function validatePayload(payload) {
  if (!payload) throw new Error('No request payload was received.');
  if (!payload.historicalCsv) throw new Error('Historical Performance CSV is required.');
  if (!payload.populationCsv) throw new Error('Audit Population CSV is required.');
}

function normalizeConfig(config) {
  const normalized = config || {};
  const minutesPerTask = Number(normalized.minutesPerTask || 5);
  if (!Number.isFinite(minutesPerTask) || minutesPerTask <= 0) {
    throw new Error('Minutes per audit task must be greater than 0.');
  }

  const tls = (normalized.tls || [])
    .map((tl, index) => ({
      name: String(tl.name || '').trim() || `TL ${index + 1}`,
      hours: Math.max(0, Number(tl.hours || 0))
    }))
    .filter(tl => tl.hours > 0);

  if (!tls.length) throw new Error('At least one TL with available hours is required.');

  return {
    minutesPerTask,
    tls,
    seed: normalized.seed || String(Date.now())
  };
}

function parseCsvObjectRows(csvText, label) {
  const rows = Utilities.parseCsv(csvText || '');
  if (!rows.length || !rows[0].length) throw new Error(`${label} is empty.`);

  const headers = rows[0].map(header => String(header || '').trim());
  const dataRows = rows.slice(1)
    .filter(row => row.some(cell => String(cell || '').trim() !== ''))
    .map(row => {
      const object = {};
      headers.forEach((header, index) => {
        object[header] = row[index] == null ? '' : String(row[index]).trim();
      });
      return object;
    });

  if (!dataRows.length) throw new Error(`${label} does not contain any data rows.`);
  return { headers, rows: dataRows };
}

function validatePopulationColumns(headers) {
  const lowerHeaders = headers.map(header => header.trim());
  const missing = REQUIRED_POPULATION_COLUMNS.filter(column => lowerHeaders.indexOf(column) === -1);
  if (missing.length) {
    throw new Error(`Audit Population CSV is missing required columns: ${missing.join(', ')}`);
  }
}

function buildHistoricalLookup(rows) {
  const lookup = {};
  rows.forEach(row => {
    const labeler = normalizeKey(row.simteacher_v2_labeler);
    if (!labeler) return;
    lookup[labeler] = row;
  });
  return lookup;
}

function enrichPopulation(rows, historicalLookup) {
  const seenTaskIds = new Set();
  const baseRows = rows
    .filter(row => {
      const taskId = String(row.imerit_task_id || '').trim();
      if (!taskId || seenTaskIds.has(taskId)) return false;
      seenTaskIds.add(taskId);
      return true;
    })
    .map(row => {
      const labeler = normalizeKey(row.simteacher_v2_labeler);
      const batchId = String(row.batch_id || '').trim();
      const historicalScore = getHistoricalScore(historicalLookup[labeler], batchId);
      const riskWeight = getRiskWeight(historicalScore);
      const confidenceWeight = getConfidenceWeight(row.qc_confidence);

      return Object.assign({}, row, {
        historical_score: historicalScore == null ? '' : historicalScore,
        risk_weight: riskWeight,
        confidence_weight: confidenceWeight,
        batch_criticality_multiplier: 1,
        priority_score: riskWeight * confidenceWeight
      });
    });

  const multipliers = calculateBatchCriticalityMultipliers(baseRows);
  return baseRows.map(row => {
    const multiplier = multipliers[String(row.batch_id || '').trim()] || 1;
    return Object.assign({}, row, {
      batch_criticality_multiplier: multiplier,
      priority_score: row.risk_weight * row.confidence_weight * multiplier
    });
  });
}

function calculateBatchCriticalityMultipliers(rows) {
  const byBatch = groupBy(rows, row => String(row.batch_id || '').trim());
  const batchIds = Object.keys(byBatch);
  const maxPopulation = Math.max.apply(null, batchIds.map(batchId => byBatch[batchId].length).concat([1]));

  return batchIds.reduce((map, batchId) => {
    const batchRows = byBatch[batchId];
    const populationFactor = batchRows.length / maxPopulation;
    const lowConfidenceFactor = batchRows.filter(row => Number(row.confidence_weight) === 2).length / Math.max(1, batchRows.length);
    const averageRiskWeight = average(batchRows.map(row => row.risk_weight));
    const historicalRiskFactor = (Number(averageRiskWeight) - 1) / 4;
    const blendedScore = (populationFactor * 0.4) + (historicalRiskFactor * 0.4) + (lowConfidenceFactor * 0.2);
    map[batchId] = Math.round((1 + blendedScore) * 100) / 100;
    return map;
  }, {});
}

function getHistoricalScore(historyRow, batchId) {
  if (!historyRow) return null;
  const exact = historyRow[batchId];
  if (exact !== undefined && String(exact).trim() !== '') return parsePercent(exact);

  const scores = Object.keys(historyRow)
    .filter(key => key !== 'simteacher_v2_labeler')
    .map(key => parsePercent(historyRow[key]))
    .filter(value => value != null);

  if (!scores.length) return null;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function parsePercent(value) {
  const cleaned = String(value || '').replace('%', '').trim();
  if (!cleaned) return null;
  const number = Number(cleaned);
  if (!Number.isFinite(number)) return null;
  return number <= 1 ? number * 100 : number;
}

function getRiskWeight(score) {
  if (score == null || !Number.isFinite(Number(score))) return 3;
  if (score > 90) return 1;
  if (score >= 80) return 2;
  if (score >= 70) return 3;
  if (score >= 50) return 4;
  return 5;
}

function getConfidenceWeight(confidence) {
  return normalizeKey(confidence) === 'low' ? 2 : 1;
}

function calculateTlCapacity(tls, minutesPerTask) {
  const tlCapacity = tls.map(tl => ({
    name: tl.name,
    hours: tl.hours,
    capacity: Math.floor((tl.hours * 60) / minutesPerTask),
    assignedAudits: 0,
    remainingCapacity: Math.floor((tl.hours * 60) / minutesPerTask)
  }));
  const totalCapacity = tlCapacity.reduce((sum, tl) => sum + tl.capacity, 0);
  if (totalCapacity <= 0) throw new Error('Total audit capacity is 0. Increase TL hours or reduce minutes per task.');
  return { tls: tlCapacity, totalCapacity };
}

function selectAuditTasks(rows, totalCapacity, seed) {
  const target = Math.min(totalCapacity, rows.length);
  if (target <= 0) return [];

  const rng = seededRandom(seed);
  const byLabeler = groupBy(rows, row => normalizeKey(row.simteacher_v2_labeler));
  const byBatch = groupBy(rows, row => String(row.batch_id || '').trim());
  const selectedMap = {};
  const selected = [];

  Object.keys(byLabeler).sort((a, b) => {
    const aRisk = Math.max.apply(null, byLabeler[a].map(row => row.priority_score));
    const bRisk = Math.max.apply(null, byLabeler[b].map(row => row.priority_score));
    return bRisk - aRisk;
  }).forEach(labeler => {
    if (selected.length >= target) return;
    const candidates = shuffle(byLabeler[labeler].slice(), rng)
      .sort((a, b) => b.priority_score - a.priority_score);
    addCandidate(candidates[0], selected, selectedMap, target);
  });

  const remainingTarget = target - selected.length;
  if (remainingTarget <= 0) return selected;

  const batchAllocations = allocateByBatchRisk(byBatch, remainingTarget, selected);
  const preselectedByBatch = Object.keys(byBatch).reduce((map, batchId) => {
    map[batchId] = countSelectedInBatch(selected, batchId);
    return map;
  }, {});

  Object.keys(batchAllocations).forEach(batchId => {
    const targetForBatch = preselectedByBatch[batchId] + batchAllocations[batchId];
    const candidates = shuffle(byBatch[batchId].slice(), rng);
    for (let i = 0; i < candidates.length && countSelectedInBatch(selected, batchId) < targetForBatch; i++) {
      addCandidate(candidates[i], selected, selectedMap, target);
    }
  });

  if (selected.length < target) {
    const leftovers = shuffle(rows.slice(), rng).sort((a, b) => b.priority_score - a.priority_score);
    leftovers.forEach(row => addCandidate(row, selected, selectedMap, target));
  }

  return selected;
}

function allocateByBatchRisk(byBatch, totalToAllocate, selected) {
  const batches = Object.keys(byBatch).map(batchId => ({
    batchId,
    population: byBatch[batchId].length - countSelectedInBatch(selected || [], batchId),
    risk: byBatch[batchId].reduce((sum, row) => sum + Number(row.priority_score || 0), 0)
  })).filter(batch => batch.population > 0);

  if (!batches.length || totalToAllocate <= 0) return {};

  const totalRisk = batches.reduce((sum, batch) => sum + batch.risk, 0) || batches.length;
  let allocated = 0;

  batches.forEach(batch => {
    const exact = totalRisk ? (batch.risk / totalRisk) * totalToAllocate : totalToAllocate / batches.length;
    batch.allocation = Math.min(batch.population, Math.floor(exact));
    batch.remainder = exact - Math.floor(exact);
    allocated += batch.allocation;
  });

  batches.sort((a, b) => b.remainder - a.remainder || b.risk - a.risk);
  for (let i = 0; allocated < totalToAllocate && batches.length; i = (i + 1) % batches.length) {
    const batch = batches[i];
    if (batch.allocation < batch.population) {
      batch.allocation += 1;
      allocated += 1;
    }
    if (batches.every(item => item.allocation >= item.population)) break;
  }

  return batches.reduce((map, batch) => {
    map[batch.batchId] = batch.allocation;
    return map;
  }, {});
}

function addCandidate(row, selected, selectedMap, target) {
  if (!row || selected.length >= target) return false;
  const taskId = String(row.imerit_task_id || '').trim();
  if (!taskId || selectedMap[taskId]) return false;
  selectedMap[taskId] = true;
  selected.push(row);
  return true;
}

function countSelectedInBatch(selected, batchId) {
  return selected.filter(row => String(row.batch_id || '').trim() === batchId).length;
}

function assignTls(selected, tls) {
  const tlQueue = tls.map(tl => Object.assign({}, tl));
  const assigned = selected.map(row => {
    tlQueue.sort((a, b) => (b.remainingCapacity / Math.max(1, b.capacity)) - (a.remainingCapacity / Math.max(1, a.capacity)));
    const tl = tlQueue.find(item => item.remainingCapacity > 0) || tlQueue[0];
    if (tl) {
      tl.assignedAudits += 1;
      tl.remainingCapacity -= 1;
    }
    return Object.assign({}, row, { assigned_tl: tl ? tl.name : '' });
  });
  assigned.tlSummary = tlQueue;
  return assigned;
}

function buildDashboardSummary(populationRows, selectedRows, capacity, startedAt, config) {
  const selectedByTaskId = selectedRows.reduce((map, row) => {
    map[String(row.imerit_task_id)] = true;
    return map;
  }, {});
  const groupedPopulation = groupBy(populationRows, row => String(row.batch_id || '').trim());
  const allocationTargets = allocateByBatchRisk(groupedPopulation, Math.min(capacity.totalCapacity, populationRows.length), []);

  const batchRows = Object.keys(groupedPopulation).map(batchId => {
    const rows = groupedPopulation[batchId];
    const selectedCount = rows.filter(row => selectedByTaskId[String(row.imerit_task_id)]).length;
    return {
      batchName: batchId,
      population: rows.length,
      averageHistoricalAccuracy: average(rows.map(row => row.historical_score).filter(value => value !== '')),
      batchCriticalityMultiplier: average(rows.map(row => row.batch_criticality_multiplier)),
      riskScore: sum(rows.map(row => row.priority_score)),
      allocatedAudits: allocationTargets[batchId] || 0,
      selectedAudits: selectedCount
    };
  }).sort((a, b) => b.riskScore - a.riskScore);

  const labelerRows = Object.keys(groupBy(populationRows, row => normalizeKey(row.simteacher_v2_labeler))).map(labeler => {
    const rows = populationRows.filter(row => normalizeKey(row.simteacher_v2_labeler) === labeler);
    const selectedCount = rows.filter(row => selectedByTaskId[String(row.imerit_task_id)]).length;
    const historical = average(rows.map(row => row.historical_score).filter(value => value !== ''));
    return {
      labeler,
      historicalScore: historical,
      riskWeight: getRiskWeight(historical),
      population: rows.length,
      selectedAudits: selectedCount
    };
  }).sort((a, b) => b.selectedAudits - a.selectedAudits || b.population - a.population);

  return {
    totalCapacity: capacity.totalCapacity,
    totalPopulation: populationRows.length,
    totalSelectedAudits: selectedRows.length,
    coveragePercent: populationRows.length ? (selectedRows.length / populationRows.length) * 100 : 0,
    minutesPerTask: config.minutesPerTask,
    generatedAt: startedAt.toISOString(),
    batchSummary: batchRows,
    labelerSummary: labelerRows,
    tlSummary: selectedRows.tlSummary || capacity.tls
  };
}

function appendAuditHistory(summary, selectedRows) {
  const props = PropertiesService.getUserProperties();
  const history = getAuditSelectionHistory();
  history.unshift({
    generatedAt: summary.generatedAt,
    totalPopulation: summary.totalPopulation,
    totalCapacity: summary.totalCapacity,
    totalSelectedAudits: summary.totalSelectedAudits,
    coveragePercent: summary.coveragePercent,
    selectedTaskIds: selectedRows.map(row => row.imerit_task_id)
  });
  props.setProperty(HISTORY_KEY, JSON.stringify(history.slice(0, 25)));
}

function toOutputRow(row) {
  return {
    imerit_task_id: row.imerit_task_id,
    qc_replay_link: row.qc_replay_link,
    batch_id: row.batch_id,
    simteacher_v2_labeler: row.simteacher_v2_labeler,
    v2_end_date_ist: row.v2_end_date_ist,
    selectQcResult: row.selectQcResult,
    failureReason: row.failureReason,
    qc_confidence: row.qc_confidence,
    historical_score: formatNumber(row.historical_score),
    risk_weight: row.risk_weight,
    confidence_weight: row.confidence_weight,
    batch_criticality_multiplier: formatNumber(row.batch_criticality_multiplier),
    priority_score: formatNumber(row.priority_score),
    assigned_tl: row.assigned_tl
  };
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  rows.forEach(row => {
    lines.push(headers.map(header => csvEscape(row[header])).join(','));
  });
  return lines.join('\n');
}

function toExcelHtml(rows, summary) {
  const outputRows = rows.length ? rows : [{}];
  const headers = Object.keys(outputRows[0]);
  const tableRows = rows.map(row => `<tr>${headers.map(header => `<td>${htmlEscape(row[header])}</td>`).join('')}</tr>`).join('');
  return `
    <html>
      <head><meta charset="utf-8"></head>
      <body>
        <h2>${APP_TITLE}</h2>
        <p>Total Capacity: ${summary.totalCapacity} | Selected Audits: ${summary.totalSelectedAudits}</p>
        <table border="1">
          <thead><tr>${headers.map(header => `<th>${htmlEscape(header)}</th>`).join('')}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>`;
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function htmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function groupBy(rows, keyFn) {
  return rows.reduce((map, row) => {
    const key = keyFn(row) || 'unknown';
    if (!map[key]) map[key] = [];
    map[key].push(row);
    return map;
  }, {});
}

function shuffle(rows, rng) {
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = rows[i];
    rows[i] = rows[j];
    rows[j] = temp;
  }
  return rows;
}

function seededRandom(seedText) {
  let seed = 2166136261;
  String(seedText || 'simteacher').split('').forEach(char => {
    seed ^= char.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  });
  return function() {
    seed += 0x6D2B79F5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function average(values) {
  const numeric = values.map(Number).filter(value => Number.isFinite(value));
  return numeric.length ? numeric.reduce((sumValue, value) => sumValue + value, 0) / numeric.length : '';
}

function sum(values) {
  return values.map(Number).filter(value => Number.isFinite(value)).reduce((sumValue, value) => sumValue + value, 0);
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : '';
}
