// make sure the user is logged in before anything else runs
authGuard();
// Both admins and doctors can access reports, but doctors only see the clinical tab
checkRole(['admin', 'doctor']) || (location.href = '/dashboard/index.html');
checkSessionTimeout();

document.getElementById('header-slot').outerHTML = renderHeader();
document.getElementById('sidebar-slot').outerHTML = renderSidebar('reports');
applyRoleVisibility();

const currentRole = sessionStorage.getItem('role');

// Doctors shouldn't see financial, operational, or patient tabs — hide them
// and automatically land them on the clinical tab instead
if (currentRole === 'doctor') {
  ['financial', 'operational', 'patient'].forEach(type => {
    const btn = document.querySelector(`[onclick*="switchReport('${type}'"]`);
    if (btn) btn.style.display = 'none';
    const panel = document.getElementById(`panel-${type}`);
    if (panel) panel.style.display = 'none';
  });
  // Simulate clicking the clinical tab so it activates properly
  const clinBtn = document.querySelector(`[onclick*="switchReport('clinical'"]`);
  if (clinBtn) clinBtn.click();
}

let currentReport = 'financial';
let reportData    = null;
let patientReport = null;

function switchReport(type, btn) {
  // Deactivate all panels and tabs, then activate the one that was clicked
  document.querySelectorAll('.report-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`panel-${type}`).classList.add('active');
  btn.classList.add('active');
  currentReport = type;
}

async function generateReport(type) {
  // Patient report is built client-side from /api/patients — no dedicated endpoint
  if (type === 'patient') {
    const from = document.getElementById('pat-from').value;
    const to   = document.getElementById('pat-to').value;
    try {
      const res = await apiFetch('/api/patients');
      const patients = res?.patients || [];

      // Normalize any date value to YYYY-MM-DD so comparisons work reliably
      const toYMD = v => {
        if (!v) return '';
        const s = String(v);
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
        const d = new Date(s);
        return isNaN(d.getTime()) ? '' : d.toISOString().slice(0,10);
      };

      // If no date range is set, show all patients; otherwise filter by registration date
      const filtered = (!from || !to) ? patients : patients.filter(p => {
        const day = toYMD(p.registered_at);
        return day && day >= from && day <= to;
      });

      const monthPrefix = new Date().toISOString().slice(0,7);
      patientReport = {
        patients: filtered,
        total: filtered.length,
        new_this_month: filtered.filter(p => toYMD(p.registered_at).startsWith(monthPrefix)).length,
        gender: {
          M: filtered.filter(p => p.gender === 'M').length,
          F: filtered.filter(p => p.gender === 'F').length,
          O: filtered.filter(p => p.gender === 'O' || (p.gender && p.gender !== 'M' && p.gender !== 'F')).length
        }
      };
      showResults('patient');
      showToast('Patient report generated', 'success');
    } catch (e) {
      showToast('Failed to generate report', 'error');
    }
    return;
  }

  // For financial, clinical, and operational — each tab has its own date inputs
  const fields = { financial: ['fin-from','fin-to'], clinical: ['cli-from','cli-to'], operational: ['op-from','op-to'] };
  const [fromId, toId] = fields[type];
  const from = document.getElementById(fromId).value;
  const to   = document.getElementById(toId).value;

  if (!from || !to) { showToast('Please select both date ranges', 'error'); return; }

  try {
    const res = await apiFetch(`/api/reports/${type}?from=${from}&to=${to}`);

    if (type === 'financial') {
      const byMethod = res?.by_method || [];
      const byStatus = res?.by_status || [];
      // Outstanding = sum of all invoices that haven't been fully paid
      const outstanding = byStatus.reduce((s, r) => r.payment_status !== 'Paid' ? s + Number(r.total_owed || 0) : s, 0);
      reportData = {
        total_collected: Number(res?.total_collected || 0),
        outstanding,
        details: [
          ...byMethod.map(r => ({ Category: 'Payment Method', Label: r.payment_method, Transactions: r.transactions, Total: r.total })),
          ...byStatus.map(r => ({ Category: 'Invoice Status', Label: r.payment_status, Count: r.count, 'Amount Owed': r.total_owed }))
        ]
      };
    } else if (type === 'clinical') {
      const top = res?.top_diagnoses || [];
      reportData = {
        total_visits: Number(res?.total_visits || 0),
        top_diagnosis: top[0]?.description || '—',
        details: top.map(r => ({ Diagnosis: r.description, Frequency: r.frequency }))
      };
    } else if (type === 'operational') {
      const byStatus = res?.appointments_by_status || [];
      const total = byStatus.reduce((s, r) => s + Number(r.count || 0), 0);
      const completed = byStatus.find(r => r.status === 'Completed')?.count || 0;
      const cancelled = byStatus.find(r => r.status === 'Cancelled')?.count || 0;
      reportData = {
        total_appointments: total,
        completion_rate:    total ? (Number(completed) / total * 100) : 0,
        cancellation_rate:  total ? (Number(cancelled) / total * 100) : 0,
        avg_wait_time:      Number(res?.avg_wait_time_minutes || 0),
        details: byStatus.map(r => ({ Status: r.status, Count: r.count }))
      };
    }
    showResults(type);
    showToast('Report generated', 'success');
  } catch (e) {
    showToast('Failed to generate report', 'error');
  }
}

function showResults(type) {
  // Hide the placeholder and reveal the results section
  document.getElementById('results-placeholder').style.display = 'none';
  const content = document.getElementById('results-content');
  content.classList.remove('hidden');
  content.style.display = 'block';
  renderSummaryCards(type);
  renderChart(type);
  renderDetailTable(type);
}

function renderSummaryCards(type) {
  const el = document.getElementById('summary-cards');
  let html = '<div class="summary-cards">';

  if (type === 'patient') {
    const d = patientReport;
    html += card('Total Patients', d.total);
    html += card('New This Month', d.new_this_month);
    html += card('Male', d.gender.M);
    html += card('Female', d.gender.F);
  } else if (type === 'financial') {
    html += card('Total Collected', formatCurrency(reportData.total_collected));
    html += card('Outstanding', formatCurrency(reportData.outstanding));
  } else if (type === 'clinical') {
    html += card('Total Visits', reportData.total_visits);
    html += card('Top Diagnosis', reportData.top_diagnosis);
  } else if (type === 'operational') {
    html += card('Total Appointments', reportData.total_appointments);
    html += card('Completion Rate', reportData.completion_rate.toFixed(1) + '%');
    html += card('Cancellation Rate', reportData.cancellation_rate.toFixed(1) + '%');
    html += card('Avg Wait Time', reportData.avg_wait_time + ' min');
  }

  html += '</div>';
  el.innerHTML = html;
}

// Small helper to build a single summary card element
function card(label, value) {
  return `<div class="summary-card"><div class="summary-label">${label}</div><div class="summary-value">${value}</div></div>`;
}

function renderChart(type) {
  const el = document.getElementById('chart-container');

  if (type === 'patient') {
    const d = patientReport;
    const total = (d.gender.M + d.gender.F + d.gender.O) || 1;
    el.innerHTML = `
      <div class="chart-container">
        <div class="chart-title">Gender Distribution</div>
        <div style="display:flex;gap:20px;align-items:center;margin-top:12px;">
          <canvas id="gender-chart" width="180" height="180"></canvas>
          <div>
            ${genderLegend('#2563EB','Male', d.gender.M, total)}
            ${genderLegend('#EC4899','Female', d.gender.F, total)}
            ${genderLegend('#8B5CF6','Other', d.gender.O, total)}
          </div>
        </div>
      </div>`;
    // Small delay so the canvas is in the DOM before we try to draw on it
    setTimeout(() => drawPie('gender-chart', [d.gender.M, d.gender.F, d.gender.O], ['#2563EB','#EC4899','#8B5CF6']), 50);

  } else if (type === 'clinical') {
    const items = reportData.details || [];
    const total = items.reduce((s, r) => s + Number(r.Frequency || 0), 0) || 1;
    const colors = ['#2563EB','#0EA5E9','#10B981','#F59E0B','#EF4444','#8B5CF6'];
    el.innerHTML = `
      <div class="chart-container">
        <div class="chart-title">Top Diagnoses</div>
        <div style="display:flex;gap:20px;align-items:center;margin-top:12px;">
          <canvas id="diag-chart" width="200" height="200"></canvas>
          <div id="diag-legend" style="flex:1;"></div>
        </div>
      </div>`;
    setTimeout(() => {
      const top = items.slice(0,6);
      drawPie('diag-chart', top.map(r => Number(r.Frequency)), colors);
      document.getElementById('diag-legend').innerHTML = top.map((r,i) => {
        const pct = Math.round(Number(r.Frequency) / total * 100);
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <div style="width:12px;height:12px;border-radius:2px;background:${colors[i]};"></div>
          <span style="font-size:12px;">${r.Diagnosis}</span>
          <span style="margin-left:auto;font-size:11px;color:var(--text-muted);">${r.Frequency} (${pct}%)</span>
        </div>`;
      }).join('');
    }, 50);

  } else if (type === 'financial') {
    const byMethod = (reportData.details || []).filter(r => r.Category === 'Payment Method');
    const total = byMethod.reduce((s, r) => s + Number(r.Total || 0), 0) || 1;
    const colors = ['#2563EB','#10B981','#F59E0B','#EF4444','#8B5CF6'];
    el.innerHTML = `
      <div class="chart-container">
        <div class="chart-title">Revenue by Payment Method</div>
        <div style="display:flex;gap:20px;align-items:center;margin-top:12px;">
          <canvas id="fin-chart" width="200" height="200"></canvas>
          <div id="fin-legend" style="flex:1;"></div>
        </div>
      </div>`;
    setTimeout(() => {
      drawPie('fin-chart', byMethod.map(r => Number(r.Total)), colors);
      document.getElementById('fin-legend').innerHTML = byMethod.map((r, i) => {
        const pct = Math.round(Number(r.Total) / total * 100);
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <div style="width:12px;height:12px;border-radius:2px;background:${colors[i]};"></div>
          <span style="font-size:12px;">${r.Label}</span>
          <span style="margin-left:auto;font-size:11px;color:var(--text-muted);">${formatCurrency(Number(r.Total))} (${pct}%)</span>
        </div>`;
      }).join('');
    }, 50);

  } else if (type === 'operational') {
    const byStatus = reportData.details || [];
    const total = byStatus.reduce((s, r) => s + Number(r.Count || 0), 0) || 1;
    const colors = ['#10B981','#2563EB','#F59E0B','#EF4444','#8B5CF6','#0EA5E9'];
    el.innerHTML = `
      <div class="chart-container">
        <div class="chart-title">Appointments by Status</div>
        <div style="display:flex;gap:20px;align-items:center;margin-top:12px;">
          <canvas id="op-chart" width="200" height="200"></canvas>
          <div id="op-legend" style="flex:1;"></div>
        </div>
      </div>`;
    setTimeout(() => {
      drawPie('op-chart', byStatus.map(r => Number(r.Count)), colors);
      document.getElementById('op-legend').innerHTML = byStatus.map((r, i) => {
        const pct = Math.round(Number(r.Count) / total * 100);
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <div style="width:12px;height:12px;border-radius:2px;background:${colors[i]};"></div>
          <span style="font-size:12px;">${r.Status}</span>
          <span style="margin-left:auto;font-size:11px;color:var(--text-muted);">${r.Count} (${pct}%)</span>
        </div>`;
      }).join('');
    }, 50);

  } else {
    el.innerHTML = '';
  }
}

// Builds one legend row for the gender pie chart
function genderLegend(color, label, count, total) {
  return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
    <div style="width:14px;height:14px;border-radius:2px;background:${color};"></div>
    <span style="font-size:13px;">${label}: ${count} (${Math.round(count/total*100)}%)</span>
  </div>`;
}

// Draws a simple pie chart on a canvas element using the provided values and colors
function drawPie(canvasId, values, colors) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2, cy = canvas.height / 2, r = Math.min(cx, cy) - 10;
  const total = values.reduce((s, v) => s + v, 0) || 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  let angle = -Math.PI / 2;
  values.forEach((v, i) => {
    const slice = (v / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    angle += slice;
  });
}

function renderDetailTable(type) {
  const el = document.getElementById('detail-table');
  const data = type === 'patient' ? patientReport?.patients : reportData?.details;

  if (!data || !data.length) {
    el.innerHTML = '<p style="text-align:center;padding:24px;color:var(--text-muted);">No data available</p>';
    return;
  }

  // Patient report gets a custom table layout with specific columns
  if (type === 'patient') {
    el.innerHTML = `
      <table class="results-table">
        <thead><tr><th>Clinic #</th><th>Name</th><th>Gender</th><th>Age</th><th>Phone</th><th>Registered</th></tr></thead>
        <tbody>${data.map(p => `
          <tr>
            <td>${p.clinic_number}</td>
            <td>${p.first_name} ${p.last_name}</td>
            <td>${p.gender || '—'}</td>
            <td>${calculateAge(p.date_of_birth) || '—'}</td>
            <td>${p.phone || '—'}</td>
            <td>${formatDate(p.registered_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    return;
  }

  // For all other report types, dynamically build the table from whatever keys the data has
  const headers = Object.keys(data[0]);
  el.innerHTML = `
    <table class="results-table">
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${data.map(row => `<tr>${headers.map(h => {
        let v = row[h];
        // Format any column with "total" in the name as currency
        if (typeof v === 'number' && String(h).toLowerCase().includes('total')) v = formatCurrency(v);
        return `<td>${v ?? '—'}</td>`;
      }).join('')}</tr>`).join('')}</tbody>
    </table>`;
}