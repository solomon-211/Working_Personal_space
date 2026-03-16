authGuard();
checkRole(['admin']) || (location.href = '/dashboard/index.html');
applyRoleVisibility();
checkSessionTimeout();

const currentUsername = sessionStorage.getItem('name') || 'User';
const currentRole = sessionStorage.getItem('role') || 'Guest';
document.getElementById('user-name').textContent = currentUsername;
document.getElementById('user-role').textContent = currentRole;
document.getElementById('user-role').classList.add(currentRole);

let currentReport = 'patient';
let reportData = null;
let patientReportData = null;

function toggleSidebar() {
  document.querySelector('aside').classList.toggle('open');
}

function switchReport(reportType, triggerButton = null) {
  document.querySelectorAll('.report-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));

  document.getElementById(reportType).classList.add('active');
  if (triggerButton) {
    triggerButton.classList.add('active');
  }

  currentReport = reportType;
}

async function generateReport(type) {
  if (type === 'patient') {
    const from = document.getElementById('pat-from').value;
    const to = document.getElementById('pat-to').value;
    try {
      const response = await apiFetch('/api/patients');
      const patients = response?.patients || [];
      const toYMD = (val) => {
        if (!val) return '';
        const s = String(val);
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const d = new Date(s);
        return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
      };

      const filteredPatients = (!from || !to)
        ? patients
        : patients.filter((patient) => {
            const day = toYMD(patient.registered_at);
            return day && day >= from && day <= to;
          });

      const monthPrefix = new Date().toISOString().slice(0, 7);
      patientReportData = {
        patients: filteredPatients,
        total: filteredPatients.length,
        active: filteredPatients.length,
        new_this_month: filteredPatients.filter((p) => toYMD(p.registered_at).startsWith(monthPrefix)).length,
        gender_breakdown: {
          male: filteredPatients.filter((p) => String(p.gender || '').toUpperCase().startsWith('M')).length,
          female: filteredPatients.filter((p) => String(p.gender || '').toUpperCase().startsWith('F')).length,
          other: filteredPatients.filter((p) => {
            const g = String(p.gender || '').toUpperCase();
            return g && !g.startsWith('M') && !g.startsWith('F');
          }).length
        }
      };

      renderResults('patient');
      showToast('Patient report generated', 'success');
    } catch (error) {
      showToast('Failed to generate report', 'error');
    }
    return;
  }

  const dateFieldMap = {
    financial: { from: 'fin-from', to: 'fin-to' },
    clinical: { from: 'cli-from', to: 'cli-to' },
    operational: { from: 'op-from', to: 'op-to' }
  };

  const fields = dateFieldMap[type];
  if (!fields) {
    showToast('Unsupported report type', 'error');
    return;
  }

  const from = document.getElementById(fields.from).value;
  const to = document.getElementById(fields.to).value;

  if (!from || !to) {
    showToast('Please select both date ranges', 'warning');
    return;
  }

  try {
    const response = await apiFetch(`/api/reports/${type}?from=${from}&to=${to}`);
    if (type === 'financial') {
      const byMethod = response?.by_method || [];
      const byStatus = response?.by_status || [];
      const totalOutstanding = byStatus.reduce((sum, row) => {
        const status = String(row.payment_status || '').toLowerCase();
        return status === 'paid' ? sum : sum + Number(row.total_owed || 0);
      }, 0);
      reportData = {
        total_revenue: Number(response?.total_collected || 0),
        total_payments: Number(response?.total_collected || 0),
        outstanding: totalOutstanding,
        details: [
          ...byMethod.map((row) => ({
            category: 'Payment Method',
            label: row.payment_method,
            transactions: row.transactions,
            total: row.total
          })),
          ...byStatus.map((row) => ({
            category: 'Invoice Status',
            label: row.payment_status,
            count: row.count,
            amount_due: row.total_owed
          }))
        ]
      };
    } else if (type === 'clinical') {
      const topDiagnoses = response?.top_diagnoses || [];
      const uniquePatients = new Set(topDiagnoses.map((row) => row.description)).size;
      reportData = {
        total_visits: Number(response?.total_visits || 0),
        unique_patients: uniquePatients,
        top_reason: topDiagnoses[0]?.description || '—',
        common_visit_reasons: topDiagnoses.map((row) => ({ reason: row.description, count: Number(row.frequency || 0) })),
        details: topDiagnoses.map((row) => ({
          diagnosis: row.description,
          frequency: row.frequency
        }))
      };
    } else if (type === 'operational') {
      const byStatus = response?.appointments_by_status || [];
      const totalAppointments = byStatus.reduce((sum, row) => sum + Number(row.count || 0), 0);
      const completedCount = byStatus.find((row) => row.status === 'Completed')?.count || 0;
      const cancelledCount = byStatus.find((row) => row.status === 'Cancelled')?.count || 0;
      reportData = {
        total_appointments: totalAppointments,
        completion_rate: totalAppointments ? (Number(completedCount) / totalAppointments) * 100 : 0,
        cancellation_rate: totalAppointments ? (Number(cancelledCount) / totalAppointments) * 100 : 0,
        avg_wait_time: Number(response?.avg_wait_time_minutes || 0),
        details: byStatus.map((row) => ({
          status: row.status,
          count: row.count
        }))
      };
    } else {
      reportData = response;
    }
    renderResults(type);
    showToast('Report generated successfully', 'success');
  } catch (error) {
    showToast('Failed to generate report', 'error');
  }
}

function renderResults(type) {
  const placeholder = document.getElementById('results-placeholder');
  const content = document.getElementById('results-content');

  placeholder.classList.add('hidden');
  placeholder.style.display = 'none';
  content.classList.remove('hidden');
  content.style.display = 'block';

  renderSummaryCards(type);
  renderChart(type);
  renderDetailTable(type);
}

function renderSummaryCards(type) {
  const container = document.getElementById('summary-cards');
  let html = '<div class="summary-cards">';

  if (type === 'patient') {
    const patients = patientReportData?.patients || [];
    const activePatients = patientReportData?.active ?? patients.filter(p => p.status !== 'Inactive').length;
    const newThisMonth = patientReportData?.new_this_month ?? 0;
    const today = new Date();

    html += `
      <div class="summary-card">
        <div class="summary-label">Total Patients</div>
        <div class="summary-value">${patients.length}</div>
        <div style="font-size: 11px; color: var(--success); margin-top: 4px;">+12% from last month</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Active Patients</div>
        <div class="summary-value">${activePatients}</div>
        <div style="font-size: 11px; color: var(--text-light); margin-top: 4px;">${patients.length ? Math.round(activePatients/patients.length*100) : 0}% of total</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">New This Month</div>
        <div class="summary-value">${newThisMonth}</div>
        <div style="font-size: 11px; color: var(--text-light); margin-top: 4px;">${today.toLocaleString('default', { month: 'long', year: 'numeric' })}</div>
      </div>
    `;
  } else if (type === 'financial') {
    html += `
      <div class="summary-card">
        <div class="summary-label">Total Revenue</div>
        <div class="summary-value">${formatCurrency(reportData.total_revenue || 0)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Total Payments</div>
        <div class="summary-value">${formatCurrency(reportData.total_payments || 0)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Outstanding</div>
        <div class="summary-value">${formatCurrency(reportData.outstanding || 0)}</div>
      </div>
    `;
  } else if (type === 'clinical') {
    html += `
      <div class="summary-card">
        <div class="summary-label">Total Visits</div>
        <div class="summary-value">${reportData.total_visits || 0}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Unique Patients</div>
        <div class="summary-value">${reportData.unique_patients || 0}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Top Visit Reason</div>
        <div class="summary-value">${reportData.top_reason || '—'}</div>
      </div>
    `;
  } else if (type === 'operational') {
    html += `
      <div class="summary-card">
        <div class="summary-label">Total Appointments</div>
        <div class="summary-value">${reportData.total_appointments || 0}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Completed %</div>
        <div class="summary-value">${(reportData.completion_rate || 0).toFixed(1)}%</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Cancellation %</div>
        <div class="summary-value">${(reportData.cancellation_rate || 0).toFixed(1)}%</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Avg Wait Time</div>
        <div class="summary-value">${reportData.avg_wait_time || 0} min</div>
      </div>
    `;
  }

  html += '</div>';
  container.innerHTML = html;
}

function renderChart(type) {
  const container = document.getElementById('chart-container');

  if (type === 'patient') {
    const gb = patientReportData?.gender_breakdown || {};
    const maleCount = gb.male || 0;
    const femaleCount = gb.female || 0;
    const otherCount = gb.other || 0;
    const total = (maleCount + femaleCount + otherCount) || 1;

    container.innerHTML = `
      <div class="chart-container">
        <div class="chart-title">Patient Demographics - Gender</div>
        <div style="display: flex; gap: var(--spacing-lg); align-items: center; margin-top: var(--spacing-lg);">
          <canvas id="gender-chart" width="200" height="200"></canvas>
          <div style="flex: 1;">
            <div style="margin-bottom: var(--spacing-md);">
              <div style="display: flex; align-items: center; gap: var(--spacing-sm); margin-bottom: 4px;">
                <div style="width: 16px; height: 16px; background: #2563EB; border-radius: 2px;"></div>
                <span style="font-size: 13px;">Male: ${Math.round(maleCount/total*100)}%</span>
              </div>
              <div style="display: flex; align-items: center; gap: var(--spacing-sm); margin-bottom: 4px;">
                <div style="width: 16px; height: 16px; background: #EC4899; border-radius: 2px;"></div>
                <span style="font-size: 13px;">Female: ${Math.round(femaleCount/total*100)}%</span>
              </div>
              <div style="display: flex; align-items: center; gap: var(--spacing-sm);">
                <div style="width: 16px; height: 16px; background: #8B5CF6; border-radius: 2px;"></div>
                <span style="font-size: 13px;">Other: ${Math.round(otherCount/total*100)}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="chart-container" style="margin-top: var(--spacing-lg);">
        <div class="chart-title">Patient Status Distribution</div>
        <canvas id="status-chart" width="400" height="150"></canvas>
      </div>
    `;

    setTimeout(() => {
      drawGenderPieChart(maleCount, femaleCount, otherCount);
      drawStatusChart();
    }, 100);
    return;
  }

  if (type === 'clinical') {
    const sicknesses = reportData?.common_visit_reasons || [];
    container.innerHTML = `
      <div class="chart-container">
        <div class="chart-title">Most Common Visit Reasons</div>
        <div style="display: flex; gap: var(--spacing-lg); align-items: center; margin-top: var(--spacing-lg);">
          <canvas id="clinical-sickness-chart" width="260" height="260"></canvas>
          <div id="clinical-sickness-legend" style="flex: 1;"></div>
        </div>
      </div>
    `;

    setTimeout(() => {
      drawClinicalSicknessChart(sicknesses);
    }, 50);
    return;
  }

  const chartHTML = document.createElement('div');
  chartHTML.className = 'chart-container';
  chartHTML.innerHTML = '<div class="chart-title">Analytics Chart</div><canvas id="report-chart" width="400" height="150"></canvas>';
  container.innerHTML = chartHTML.innerHTML;

  const canvas = document.getElementById('report-chart');
  if (canvas) {
    drawChart(canvas, type);
  }
}

function drawGenderPieChart(male, female, other) {
  const canvas = document.getElementById('gender-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = 80;
  const total = male + female + other || 1;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let currentAngle = -Math.PI / 2;
  const colors = ['#2563EB', '#EC4899', '#8B5CF6'];
  const values = [male, female, other];

  values.forEach((value, index) => {
    const sliceAngle = (value / total) * 2 * Math.PI;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = colors[index];
    ctx.fill();

    currentAngle += sliceAngle;
  });
}

function drawStatusChart() {
  const canvas = document.getElementById('status-chart');
  if (!canvas) return;

  const totalPatients = patientReportData?.total || 0;
  const active = patientReportData?.active || 0;
  const inactive = totalPatients - active;

  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const padding = 40;
  const barHeight = 40;
  const maxWidth = width - padding * 2;
  const total = totalPatients || 1;

  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = '#10B981';
  ctx.fillRect(padding, padding, (active / total) * maxWidth, barHeight);
  ctx.fillStyle = '#000';
  ctx.font = '12px sans-serif';
  ctx.fillText('Active', padding, padding - 8);

  ctx.fillStyle = '#94A3B8';
  ctx.fillRect(padding, padding + barHeight + 20, (inactive / total) * maxWidth, barHeight);
  ctx.fillStyle = '#000';
  ctx.fillText('Inactive', padding, padding + barHeight + 12);
}

function drawClinicalSicknessChart(sicknesses) {
  const canvas = document.getElementById('clinical-sickness-chart');
  const legend = document.getElementById('clinical-sickness-legend');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 95;

  ctx.clearRect(0, 0, width, height);

  if (!sicknesses.length) {
    ctx.fillStyle = '#64748B';
    ctx.font = '14px sans-serif';
    ctx.fillText('No visit reason data', 54, centerY);
    if (legend) legend.innerHTML = '<div style="color: var(--text-light); font-size: 13px;">No visit reason data available for selected period</div>';
    return;
  }

  const top = sicknesses.slice(0, 6);
  const total = top.reduce((sum, item) => sum + item.count, 0) || 1;
  const colors = ['#2563EB', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

  let currentAngle = -Math.PI / 2;
  top.forEach((item, index) => {
    const sliceAngle = (item.count / total) * (Math.PI * 2);
    const pct = Math.round((item.count / total) * 100);

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = colors[index % colors.length];
    ctx.fill();

    if (pct >= 5) {
      const midAngle = currentAngle + sliceAngle / 2;
      const labelRadius = radius * 0.62;
      const labelX = centerX + Math.cos(midAngle) * labelRadius;
      const labelY = centerY + Math.sin(midAngle) * labelRadius;

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${pct}%`, labelX, labelY);
    }

    currentAngle += sliceAngle;
  });

  ctx.beginPath();
  ctx.arc(centerX, centerY, 14, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  if (legend) {
    legend.innerHTML = top.map((item, index) => {
      const pct = Math.round((item.count / total) * 100);
      const color = colors[index % colors.length];
      return `
        <div style="display: flex; align-items: center; gap: var(--spacing-sm); margin-bottom: 8px;">
          <div style="width: 14px; height: 14px; border-radius: 2px; background: ${color};"></div>
          <div style="font-size: 13px; color: var(--text);">${item.reason}</div>
          <div style="margin-left: auto; font-size: 12px; color: var(--text-light);">${item.count} (${pct}%)</div>
        </div>
      `;
    }).join('');
  }
}

function drawChart(canvas, type) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const padding = 40;

  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#2563EB';
  const barWidth = (width - padding * 2) / 7;
  for (let i = 0; i < 7; i++) {
    const h = Math.random() * (height - padding * 2) * 0.8;
    ctx.fillRect(padding + i * barWidth + 5, height - padding - h, barWidth - 10, h);
  }
}

function renderDetailTable(type) {
  const container = document.getElementById('detail-table');

  if (type === 'patient') {
    const patients = patientReportData?.patients || [];
    if (!patients.length) {
      container.innerHTML = '<p style="text-align: center; padding: var(--spacing-lg); color: var(--text-light);">No patient data available</p>';
      return;
    }

    let html = '<table class="results-table"><thead><tr>';
    html += '<th>Clinic Number</th><th>Name</th><th>Gender</th><th>Age</th><th>Phone</th><th>Registered</th><th>Status</th>';
    html += '</tr></thead><tbody>';

    patients.forEach(p => {
      const age = calculateAge(p.date_of_birth);
      const status = p.status || 'Active';
      html += `
        <tr>
          <td>${p.clinic_number}</td>
          <td>${p.first_name} ${p.last_name}</td>
          <td>${p.gender || '—'}</td>
          <td>${age || '—'}</td>
          <td>${p.phone || '—'}</td>
          <td>${formatDate(p.registered_at)}</td>
          <td><span style="padding: 4px 8px; background: ${status === 'Active' ? 'var(--success)' : 'var(--text-light)'}; color: white; border-radius: 4px; font-size: 11px;">${status}</span></td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
    return;
  }

  const data = reportData.details || [];

  if (!data.length) {
    container.innerHTML = '<p style="text-align: center; padding: var(--spacing-lg); color: var(--text-light);">No detailed data available</p>';
    return;
  }

  let html = '<table class="results-table"><thead><tr>';
  const headers = Object.keys(data[0]);
  headers.forEach(header => {
    html += `<th onclick="sortTable(this)">${header}</th>`;
  });
  html += '</tr></thead><tbody>';

  data.forEach(row => {
    html += '<tr>';
    headers.forEach(header => {
      let value = row[header];
      if (typeof value === 'number' && (header.includes('amount') || header.includes('revenue') || header.includes('payment'))) {
        value = formatCurrency(value);
      } else if (typeof value === 'string' && (header.includes('date') || header.includes('Date'))) {
        value = formatDate(value);
      }
      html += `<td>${value || '—'}</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

function sortTable(header) {
  showToast('Sorting feature coming soon', 'info');
}
