authGuard();
checkRole(['receptionist', 'admin', 'doctor']) || (location.href = '/dashboard/index.html');
checkSessionTimeout();

document.getElementById('header-slot').outerHTML = renderHeader();
document.getElementById('sidebar-slot').outerHTML = renderSidebar('appointments');
applyRoleVisibility();

// Shared page state for list, booking wizard, and calendar views.
const role = sessionStorage.getItem('role');
let allAppointments = [];
let filteredAppointments = [];
let allDoctors = [];
let currentPage = 1;
const perPage = 10;
let currentWeekOffset = 0;
let knownStatuses = {};   // appointment_id → last known status

const doctorColors = ['#DBEAFE', '#DCFCE7', '#FEF3C7', '#FCE7F3', '#EDE9FE'];

async function loadAppointments() {
  try {
    const data = await apiFetch('/api/appointments');
    const incoming = data?.appointments ?? [];

    // Find IDs that just flipped to Completed since last load
    const newlyCompleted = new Set(
      incoming
        .filter(a => a.status === 'Completed' && knownStatuses[a.appointment_id] === 'Scheduled')
        .map(a => a.appointment_id)
    );

    // Update known statuses
    incoming.forEach(a => { knownStatuses[a.appointment_id] = a.status; });

    allAppointments = incoming;
    filteredAppointments = [...allAppointments];
    currentPage = 1;
    renderTable();

    // Flash rows that just completed (visible to admin/receptionist)
    if (newlyCompleted.size > 0 && role !== 'doctor') {
      newlyCompleted.forEach(id => {
        const rows = document.querySelectorAll('#appointments-tbody tr');
        rows.forEach(row => {
          // match by appointment_id embedded in the View button onclick
          if (row.innerHTML.includes(`openViewModal(${id})`)) {
            row.classList.add('row-just-completed');
            setTimeout(() => row.classList.remove('row-just-completed'), 2100);
          }
        });
      });
    }
  } catch (e) {
    document.getElementById('appointments-tbody').innerHTML = `
      <tr><td colspan="6">
        <div class="empty-state">
          <div class="empty-state-text">
            Could not load appointments. Please try again.
          </div>
        </div>
      </td></tr>`;
  }
}

async function loadDoctorsForBooking() {
  try {
    const data = await apiFetch('/api/doctors');
    allDoctors = data?.doctors ?? [];
  } catch (e) {}
}

function renderDoctorCards() {
  const container = document.getElementById('doctor-cards');
  if (!container) return;
  if (allDoctors.length === 0) {
    container.innerHTML = `<div style="font-size:13px;color:var(--text-muted);grid-column:1/-1;">No doctors available</div>`;
    return;
  }
  container.innerHTML = allDoctors.map(d => `
    <div id="doc-card-${d.doctor_id}"
         onclick="selectDoctorCard(${d.doctor_id})"
         style="border:2px solid var(--border);border-radius:10px;padding:10px 12px;cursor:pointer;transition:border-color .15s,background .15s;">
      <div style="font-weight:600;font-size:13px;margin-bottom:2px;">${d.full_name}</div>
      <div style="font-size:11px;color:var(--text-muted);">${d.specialization ?? ''}</div>
    </div>
  `).join('');
}

function selectDoctorCard(doctorId) {
  document.getElementById('booking-doctor').value = doctorId;
  document.querySelectorAll('[id^="doc-card-"]').forEach(el => {
    el.style.borderColor = 'var(--border)';
    el.style.background = '';
  });
  const card = document.getElementById(`doc-card-${doctorId}`);
  if (card) { card.style.borderColor = '#2563EB'; card.style.background = '#EFF6FF'; }
  loadAvailableSlots();
}

function renderTable() {
  const tbody = document.getElementById('appointments-tbody');
  const result = paginate(filteredAppointments, currentPage, perPage);

  if (result.items.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="6">
        <div class="empty-state">
          <div class="empty-state-text">
            No appointments booked yet
          </div>
        </div>
      </td></tr>`;

    document.getElementById('apt-pagination-info').textContent = '';
    document.getElementById('apt-pagination-controls').innerHTML='';
    return;
  }

  tbody.innerHTML = result.items.map(a => `
    <tr>
      <td>
        <div style="font-weight:500;">
          ${a.first_name ?? ''} ${a.last_name ?? ''}
        </div>
      </td>
      <td>${a.doctor_name ?? '—'}</td>
      <td>
        ${formatDate(a.appointment_datetime)}
        <span style="color:var(--text-muted);font-size:12px;">
          ${formatTime(a.appointment_datetime)}
        </span>
      </td>
      <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${a.reason ?? '—'}
      </td>
      <td>${renderStatusTracker(a.status, viewApprovedIds.has(a.appointment_id))}</td>
      <td>
        <div style="display:flex;gap:4px;">
          <button class="btn btn-outline btn-sm" onclick="openViewModal(${a.appointment_id})">View</button>
          ${a.status === 'Scheduled' && (role === 'admin' || role === 'receptionist') ? `
            <button class="btn btn-danger btn-sm" onclick="cancelAppointment(${a.appointment_id})">Cancel</button>
          ` : ''}
        </div>
      </td>
    </tr>
  `).join('');

  document.getElementById('apt-pagination-info').textContent =
    `Showing ${result.start}–${result.end} of ${result.total} appointments`;

  renderPagination('apt-pagination-controls', result.totalPages, currentPage, (page) => {
    currentPage = page;
    renderTable();
  });
}

function renderStatusTracker(status, isApproved) {
  const step = status === 'Completed' ? 3 : (isApproved ? 2 : 1);
  const dot = (active) => `<span style="width:8px;height:8px;border-radius:50%;display:inline-block;background:${active ? '#22C55E' : '#E2E8F0'};"></span>`;
  const line = (active) => `<span style="display:inline-block;width:18px;height:2px;background:${active ? '#22C55E' : '#E2E8F0'};vertical-align:middle;margin:0 2px;"></span>`;
  const label = (text, color, bold) => `<span style="font-size:11px;color:${color};${bold ? 'font-weight:600;' : ''}">${text}</span>`;

  if (status === 'Cancelled' || status === 'No-show') {
    return renderBadge(status);
  }

  return `<div style="display:flex;align-items:center;gap:2px;white-space:nowrap;">
    ${dot(step >= 1)}${label('Pending', step === 1 ? '#F59E0B' : '#64748B', step === 1)}
    ${line(step >= 2)}
    ${dot(step >= 2)}${label('Approved', step === 2 ? '#2563EB' : (step > 2 ? '#64748B' : '#CBD5E1'), step === 2)}
    ${line(step >= 3)}
    ${dot(step >= 3)}${label('Completed', step === 3 ? '#22C55E' : '#CBD5E1', step === 3)}
  </div>`;
}

function filterAppointments(query) {
  const q = query.trim().toLowerCase();
  document.getElementById('apt-search-clear').style.display = q ? 'block' : 'none';
  filteredAppointments = q
    ? allAppointments.filter(a =>
        `${a.first_name ?? ''} ${a.last_name ?? ''}`.toLowerCase().includes(q) ||
        (a.doctor_name ?? '').toLowerCase().includes(q) ||
        (a.reason ?? '').toLowerCase().includes(q) ||
        (a.status ?? '').toLowerCase().includes(q)
      )
    : [...allAppointments];
  currentPage = 1;
  renderTable();
}

function clearAptSearch() {
  const input = document.getElementById('apt-search');
  input.value = '';
  document.getElementById('apt-search-clear').style.display = 'none';
  filteredAppointments = [...allAppointments];
  currentPage = 1;
  renderTable();
  input.focus();
}

async function cancelAppointment(id) {
  if (!confirm('Are you sure you want to cancel this appointment?')) return;

  try {
    await apiFetch(`/api/appointments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Cancelled' })
    });
    showToast('Appointment cancelled', 'success');
    loadAppointments();
  } catch (e) {
    showToast(e.message || 'Failed to cancel appointment', 'error');
  }
}

function openBookingModal() {
  document.getElementById('booking-date').min = new Date().toISOString().split('T')[0];
  bookingNextStep(1);
  document.getElementById('booking-modal').classList.add('open');
}

function bookingNextStep(step) {
  if (step === 2 && !document.getElementById('selected-patient-id').value) {
    showToast('Please select a patient first', 'error'); return;
  }
  if (step === 3) {
    if (!document.getElementById('booking-doctor').value) {
      showToast('Please select a doctor', 'error'); return;
    }
    if (!document.getElementById('booking-date').value) {
      showToast('Please select a date', 'error'); return;
    }
  }

  [1, 2, 3].forEach(s => {
    document.getElementById(`booking-step-${s}`).style.display = s === step ? 'block' : 'none';
  });

  if (step === 2) renderDoctorCards();

  const colors = { active: '#2563EB', done: '#22C55E', inactive: '#E2E8F0' };
  const textColors = { active: '#2563EB', done: '#22C55E', inactive: 'var(--text-muted)' };
  [1, 2, 3].forEach(s => {
    const dot = document.getElementById(`step${s}-dot`);
    const ind = document.getElementById(`step${s}-indicator`);
    if (!dot || !ind) return;
    if (s < step) {
      dot.style.background = colors.done; dot.style.color = 'white'; ind.style.color = textColors.done;
    } else if (s === step) {
      dot.style.background = colors.active; dot.style.color = 'white'; ind.style.color = textColors.active;
    } else {
      dot.style.background = colors.inactive; dot.style.color = '#94A3B8'; ind.style.color = textColors.inactive;
    }
  });
}

function closeBookingModal() {
  document.getElementById('booking-modal').classList.remove('open');
  document.getElementById('patient-search-input').value = '';
  document.getElementById('selected-patient-id').value = '';
  document.getElementById('selected-patient-display').textContent = '';
  document.getElementById('booking-doctor').value = '';
  document.getElementById('booking-date').value = '';
  document.getElementById('booking-reason').value = '';
  document.getElementById('time-slots').innerHTML =
    `<span style="font-size:12px;color:var(--text-muted);">Select a doctor and date first</span>`;
  document.getElementById('selected-time').value = '';
  document.querySelectorAll('[id^="doc-card-"]').forEach(el => {
    el.style.borderColor = 'var(--border)';
    el.style.background = '';
  });
  bookingNextStep(1);
}

const searchPatients = debounce(async (query) => {
  if (query.length < 2) {
    document.getElementById('patient-search-results').style.display = 'none';
    return;
  }

  try {
    const data = await apiFetch(`/api/patients?search=${encodeURIComponent(query)}`);
    const patients = data?.patients ?? [];
    const resultsEl = document.getElementById('patient-search-results');

    if (patients.length === 0) {
      resultsEl.innerHTML = `
        <div style="padding:10px 12px;font-size:13px;color:var(--text-muted);">
          No patients found
        </div>`;
    } else {
      resultsEl.innerHTML = patients.slice(0, 6).map(p => `
        <div onclick="selectPatient(${p.patient_id},'${p.first_name} ${p.last_name}','${p.clinic_number}')"
             style="padding:10px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);"
             onmouseover="this.style.background='var(--bg)'"
             onmouseout="this.style.background='white'">
          <strong>${p.first_name} ${p.last_name}</strong>
          <span style="color:var(--text-muted);margin-left:6px;">
            ${p.clinic_number}
          </span>
        </div>
      `).join('');
    }

    resultsEl.style.display = 'block';

  } catch (e) {}
}, 300);

document.getElementById('patient-search-input').addEventListener('input', (e) => {
  searchPatients(e.target.value);
});

function selectPatient(id, name, clinicNum) {
  document.getElementById('selected-patient-id').value = id;
  document.getElementById('patient-search-input').value = `${name} (${clinicNum})`;
  document.getElementById('selected-patient-display').textContent = `${name} selected`;
  document.getElementById('patient-search-results').style.display = 'none';
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#patient-search-input') && !e.target.closest('#patient-search-results')) {
    document.getElementById('patient-search-results').style.display = 'none';
  }
});

async function loadAvailableSlots() {
  const doctorId = document.getElementById('booking-doctor').value;
  const date = document.getElementById('booking-date').value;
  const slotsEl = document.getElementById('time-slots');

  if (!doctorId || !date) return;

  slotsEl.innerHTML = `<span class="spinner spinner-dark" style="width:16px;height:16px;"></span>`;
  document.getElementById('selected-time').value = '';

  try {
    const data = await apiFetch(`/api/doctor-schedules/${doctorId}?date=${date}`);

    if (!data.available) {
      const [y, m, d] = date.split('-').map(Number);
      const dayOfWeek = new Date(y, m - 1, d).getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      slotsEl.innerHTML = `<span style="font-size:12px;color:var(--danger);">${isWeekend ? 'Doctor does not work on weekends' : 'Doctor does not work on this day'}</span>`;
      return;
    }

    const startHour = parseInt((data.start_time ?? '08:00:00').split(':')[0]);
    const allSlots = [];
    for (let h = startHour; h <= 17; h++) {
      allSlots.push(`${String(h).padStart(2,'0')}:00`);
    }

    const booked = (data.booked_slots ?? []).map(b => {
      const t = b.split(' ')[1] ?? b;
      return t.substring(0, 5);
    });

    const todayStr = new Date().toISOString().split('T')[0];
    const nowHour  = new Date().getHours();

    const available = allSlots.filter(s => {
      if (booked.includes(s)) return false;
      if (date === todayStr && parseInt(s.split(':')[0]) <= nowHour) return false;
      return true;
    });

    if (available.length === 0) {
      slotsEl.innerHTML = `<span style="font-size:12px;color:var(--danger);">No available slots for this date</span>`;
      return;
    }

    slotsEl.innerHTML = available.map(slot => `
      <button type="button" class="btn btn-outline btn-sm" id="slot-${slot}" onclick="selectSlot('${slot}')">
        ${slot}
      </button>
    `).join('');

  } catch (e) {
    slotsEl.innerHTML = `<span style="font-size:12px;color:var(--danger);">Could not load slots. Try again.</span>`;
  }
}

function selectSlot(time) {
  document.querySelectorAll('[id^="slot-"]').forEach(b => {
    b.style.background = '';
    b.style.color = '';
  });

  const btn = document.getElementById(`slot-${time}`);
  if (btn) {
    btn.style.background = 'var(--primary)';
    btn.style.color = 'white';
  }

  document.getElementById('selected-time').value = time;
}

async function submitBooking() {
  const patientId = document.getElementById('selected-patient-id').value;
  const doctorId = document.getElementById('booking-doctor').value;
  const date = document.getElementById('booking-date').value;
  const time = document.getElementById('selected-time').value;
  const reason = document.getElementById('booking-reason').value;

  if (!patientId || !doctorId || !date || !time) {
    showToast('Please select patient, doctor, date and time slot', 'error');
    return;
  }

  try {
    await apiFetch('/api/appointments', {
      method: 'POST',
      body: JSON.stringify({
        patient_id: parseInt(patientId),
        doctor_id:  parseInt(doctorId),
        appointment_datetime: `${date} ${time}:00`,
        reason,
        status: 'Scheduled'
      })
    });

    closeBookingModal();
    showToast('Appointment scheduled successfully', 'success');
    loadAppointments();

  } catch (e) {
    showToast(e.message || 'Failed to schedule appointment', 'error');
  }
}

function switchView(view, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  document.getElementById('view-list').style.display = view === 'list' ? 'block' : 'none';
  document.getElementById('view-calendar').style.display = view === 'calendar' ? 'block' : 'none';

  if (view === 'calendar') renderCalendar();
}

function changeWeek(offset) {
  currentWeekOffset += offset;
  renderCalendar();
}

function renderCalendar() {
  const today = new Date();
  const monday = new Date(today);
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(today.getDate() + diff + (currentWeekOffset * 7));

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }

  const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const hours = [];
  for (let h = 8; h <= 17; h++) {
    hours.push(`${String(h).padStart(2,'0')}:00`);
  }

  const startStr = days[0].toLocaleDateString('en-GB');
  const endStr   = days[6].toLocaleDateString('en-GB');
  document.getElementById('week-label').textContent = `${startStr} — ${endStr}`;

  const todayStr = today.toISOString().split('T')[0];

  const activeApts = allAppointments.filter(
    a => a.status !== 'Completed' && a.status !== 'Cancelled' && a.status !== 'No-show'
  );

  const borderColors = ['#93C5FD','#86EFAC','#FCD34D','#F9A8D4','#C4B5FD'];

  let html = `<div style="display:grid;grid-template-columns:56px repeat(7,1fr);border:1px solid var(--border);border-radius:8px;overflow:hidden;min-width:700px;">`;

  html += `<div style="background:var(--bg);border-bottom:2px solid var(--border);padding:10px 6px;"></div>`;
  days.forEach((d, i) => {
    const ds = d.toISOString().split('T')[0];
    const isToday = ds === todayStr;
    html += `<div style="background:${isToday ? '#EFF6FF' : 'var(--bg)'};border-bottom:2px solid var(--border);border-left:1px solid var(--border);padding:10px 6px;text-align:center;font-size:12px;font-weight:${isToday ? '700' : '600'};color:${isToday ? 'var(--primary)' : 'var(--text)'}">
      ${dayNames[i]}<br><span style="font-size:14px;">${d.getDate()}</span>
    </div>`;
  });

  hours.forEach(hour => {
    html += `<div style="border-bottom:1px solid var(--border);padding:6px;font-size:11px;color:var(--text-muted);background:var(--bg);white-space:nowrap;">${hour}</div>`;
    days.forEach(d => {
      const ds = d.toISOString().split('T')[0];
      const apt = activeApts.find(a => {
        const dt = new Date(a.appointment_datetime);
        if (isNaN(dt.getTime())) return false;
        const aptDate = dt.toISOString().split('T')[0];
        const aptHour = `${String(dt.getUTCHours()).padStart(2,'0')}:00`;
        return aptDate === ds && aptHour === hour;
      });
      if (apt) {
        const colorIdx  = (apt.doctor_id - 1) % doctorColors.length;
        const borderCol = borderColors[(apt.doctor_id - 1) % borderColors.length];
        html += `<div onclick="openViewModal(${apt.appointment_id})"
          style="border-bottom:1px solid var(--border);border-left:3px solid ${borderCol};padding:5px 6px;background:${doctorColors[colorIdx]};cursor:pointer;min-height:44px;transition:opacity .15s;"
          onmouseover="this.style.opacity='.75'" onmouseout="this.style.opacity='1'">
          <div style="font-size:11px;font-weight:700;color:#1E293B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${apt.first_name ?? ''} ${apt.last_name ?? ''}</div>
          <div style="font-size:10px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${apt.doctor_name ?? ''}</div>
          <div style="font-size:10px;color:#64748B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-style:italic;">${apt.reason ?? ''}</div>
        </div>`;
      } else {
        html += `<div style="border-bottom:1px solid var(--border);border-left:1px solid var(--border);min-height:44px;"></div>`;
      }
    });
  });

  html += `</div>`;
  document.getElementById('calendar-grid').innerHTML = html;
}

let viewApprovedIds = new Set();

function openViewModal(id) {
  const a = allAppointments.find(x => x.appointment_id === id);
  if (!a) return;

  document.getElementById('vm-patient-name').textContent = `${a.first_name ?? ''} ${a.last_name ?? ''}`;
  document.getElementById('vm-clinic-number').textContent = a.clinic_number ?? '—';
  document.getElementById('vm-doctor').textContent = a.doctor_name ?? '—';
  document.getElementById('vm-datetime').textContent =
    `${formatDate(a.appointment_datetime)} ${formatTime(a.appointment_datetime)}`;
  document.getElementById('vm-reason').textContent = a.reason ?? '—';

  const isApproved = viewApprovedIds.has(id);
  const status = a.status;

  const dotPending   = document.getElementById('vm-dot-pending');
  const dotApproved  = document.getElementById('vm-dot-approved');
  const dotCompleted = document.getElementById('vm-dot-completed');
  const line1 = document.getElementById('vm-line-1');
  const line2 = document.getElementById('vm-line-2');

  [dotPending, dotApproved, dotCompleted].forEach(d => { d.style.background = '#E2E8F0'; });
  [line1, line2].forEach(l => { l.style.background = 'var(--border)'; });
  document.getElementById('vm-step-pending').style.color = 'var(--text-muted)';
  document.getElementById('vm-step-approved').style.color = 'var(--text-muted)';
  document.getElementById('vm-step-completed').style.color = 'var(--text-muted)';

  if (status === 'Completed') {
    dotPending.style.background = '#22C55E';
    dotApproved.style.background = '#22C55E';
    dotCompleted.style.background = '#22C55E';
    line1.style.background = '#22C55E';
    line2.style.background = '#22C55E';
    document.getElementById('vm-step-pending').style.color = 'var(--text)';
    document.getElementById('vm-step-approved').style.color = 'var(--text)';
    document.getElementById('vm-step-completed').style.color = '#22C55E';
    document.getElementById('vm-step-completed').style.fontWeight = '600';
  } else if (isApproved) {
    dotPending.style.background = '#22C55E';
    dotApproved.style.background = '#2563EB';
    line1.style.background = '#22C55E';
    document.getElementById('vm-step-pending').style.color = 'var(--text)';
    document.getElementById('vm-step-approved').style.color = '#2563EB';
    document.getElementById('vm-step-approved').style.fontWeight = '600';
  } else if (status === 'Scheduled') {
    dotPending.style.background = '#F59E0B';
    document.getElementById('vm-step-pending').style.color = '#F59E0B';
    document.getElementById('vm-step-pending').style.fontWeight = '600';
  } else {
    dotPending.style.background = '#EF4444';
    document.getElementById('vm-step-pending').style.color = '#EF4444';
  }

  const actionsEl = document.getElementById('vm-actions');
  actionsEl.innerHTML = '';

  if (role === 'doctor' && status === 'Scheduled') {
    if (!isApproved) {
      const approveBtn = document.createElement('button');
      approveBtn.className = 'btn btn-primary btn-sm';
      approveBtn.textContent = 'Approve for Consultation';
      approveBtn.onclick = () => { viewApprovedIds.add(id); closeViewModal(); openViewModal(id); };
      actionsEl.appendChild(approveBtn);
    } else {
      const consultBtn = document.createElement('button');
      consultBtn.className = 'btn btn-primary btn-sm';
      consultBtn.textContent = 'Start Consultation';
      consultBtn.onclick = () => { closeViewModal(); openConsultationModal(a); };
      actionsEl.appendChild(consultBtn);
    }
  }

  if (role === 'admin' || role === 'receptionist') {
    if (status === 'Scheduled') {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-danger btn-sm';
      cancelBtn.textContent = 'Cancel Appointment';
      cancelBtn.onclick = () => { cancelAppointment(id); closeViewModal(); };
      actionsEl.appendChild(cancelBtn);
    }
  }

  document.getElementById('view-modal').classList.add('open');
}

function closeViewModal() {
  document.getElementById('view-modal').classList.remove('open');
}

loadDoctorsForBooking();
loadAppointments();
setInterval(loadAppointments, 30_000);

let consultationAppointment = null;

function openConsultationModal(appt) {
  consultationAppointment = appt;
  document.getElementById('cons-title').textContent =
    `Consultation — ${appt.first_name ?? ''} ${appt.last_name ?? ''}`;
  document.getElementById('cons-patient-name').textContent =
    `${appt.first_name ?? ''} ${appt.last_name ?? ''}`;
  document.getElementById('cons-clinic-num').textContent  = appt.clinic_number ?? '—';
  document.getElementById('cons-date').textContent        = formatDate(appt.appointment_datetime);
  document.getElementById('cons-notes').value             = '';
  document.getElementById('diagnoses-list').innerHTML     = '';
  document.getElementById('prescriptions-list').innerHTML = '';
  addDiagnosisRow();
  addPrescriptionRow();
  document.getElementById('consultation-modal').classList.add('open');
}

function closeConsultationModal() {
  document.getElementById('consultation-modal').classList.remove('open');
  consultationAppointment = null;
}

function addDiagnosisRow() {
  const list = document.getElementById('diagnoses-list');
  const row  = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;align-items:center;';
  row.innerHTML = `
    <input type="text" class="form-control diagnosis-input"
           placeholder="e.g. Plasmodium falciparum malaria — uncomplicated"
           style="flex:1;">
    <button type="button" class="btn btn-outline btn-sm"
            onclick="this.parentElement.remove()"
            style="padding:6px 10px;color:var(--danger);border-color:var(--danger);">Remove</button>
  `;
  list.appendChild(row);
}

function addPrescriptionRow() {
  const list = document.getElementById('prescriptions-list');
  const row  = document.createElement('div');
  row.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:10px 12px;position:relative;';
  row.innerHTML = `
    <button type="button"
            onclick="this.parentElement.remove()"
            style="position:absolute;top:8px;right:8px;background:none;border:none;color:var(--text-muted);font-size:14px;cursor:pointer;line-height:1;">Remove</button>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div class="form-group" style="margin:0;">
        <label class="form-label" style="font-size:11px;">Drug Name <span class="required">*</span></label>
        <input type="text" class="form-control rx-drug" placeholder="e.g. Amoxicillin">
      </div>
      <div class="form-group" style="margin:0;">
        <label class="form-label" style="font-size:11px;">Dosage</label>
        <input type="text" class="form-control rx-dosage" placeholder="e.g. 500mg twice daily">
      </div>
      <div class="form-group" style="margin:0;">
        <label class="form-label" style="font-size:11px;">Duration</label>
        <input type="text" class="form-control rx-duration" placeholder="e.g. 7 days">
      </div>
    </div>
  `;
  list.appendChild(row);
}

function closeSummaryModal() {
  document.getElementById('summary-modal').classList.remove('open');
}

function openSummaryModal(appt, diagnoses, prescriptions, visitDate) {
  const body = document.getElementById('summary-body');

  const diagHtml = diagnoses.length
    ? diagnoses.map(d => `<div class="summary-item">${d}</div>`).join('')
    : `<div class="summary-item" style="color:var(--text-muted);">None recorded</div>`;

  const rxHtml = prescriptions.length
    ? prescriptions.map(rx => `
        <div class="summary-rx">
          <div class="summary-rx-drug">${rx.drug_name}</div>
          <div class="summary-rx-detail">${[rx.dosage, rx.duration].filter(Boolean).join(' — ')}</div>
        </div>`).join('')
    : `<div class="summary-item" style="color:var(--text-muted);">None prescribed</div>`;

  body.innerHTML = `
    <div class="summary-patient-banner">
      <div><span style="color:var(--text-muted);">Patient: </span><strong>${appt.first_name ?? ''} ${appt.last_name ?? ''}</strong></div>
      <div><span style="color:var(--text-muted);">Clinic #: </span><strong>${appt.clinic_number ?? '—'}</strong></div>
      <div><span style="color:var(--text-muted);">Date: </span><strong>${visitDate}</strong></div>
    </div>
    <div class="summary-section">
      <div class="summary-section-title">Diagnoses</div>
      ${diagHtml}
    </div>
    <div class="summary-section">
      <div class="summary-section-title">Prescriptions</div>
      ${rxHtml}
    </div>
  `;
  document.getElementById('summary-modal').classList.add('open');
}


async function submitConsultation() {
  const appt = consultationAppointment;
  if (!appt) return;

  const notes = document.getElementById('cons-notes').value.trim();

  const diagnoses = [...document.querySelectorAll('.diagnosis-input')]
    .map(i => i.value.trim()).filter(Boolean);

  const prescriptions = [...document.querySelectorAll('#prescriptions-list > div')]
    .map(row => ({
      drug_name: row.querySelector('.rx-drug')?.value.trim()     || '',
      dosage:    row.querySelector('.rx-dosage')?.value.trim()   || '',
      duration:  row.querySelector('.rx-duration')?.value.trim() || ''
    }))
    .filter(rx => rx.drug_name);

  const rawDt = appt.appointment_datetime ?? '';
  const parsedDt = new Date(rawDt);
  const visitDate = isNaN(parsedDt.getTime())
    ? new Date().toISOString().split('T')[0]
    : parsedDt.toISOString().split('T')[0];

  try {
    const visitData = await apiFetch('/api/medical-visits', {
      method: 'POST',
      body: JSON.stringify({
        patient_id:     appt.patient_id,
        doctor_id:      appt.doctor_id,
        appointment_id: appt.appointment_id,
        visit_date:     visitDate,
        notes
      })
    });
    const visitId = visitData?.visit_id;

    for (const description of diagnoses) {
      await apiFetch('/api/diagnoses', {
        method: 'POST',
        body: JSON.stringify({ visit_id: visitId, description })
      });
    }

    for (const rx of prescriptions) {
      await apiFetch('/api/prescriptions', {
        method: 'POST',
        body: JSON.stringify({
          visit_id:  visitId,
          drug_name: rx.drug_name,
          dosage:    rx.dosage,
          duration:  rx.duration
        })
      });
    }

    await apiFetch(`/api/appointments/${appt.appointment_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Completed' })
    });

    closeConsultationModal();
    openSummaryModal(appt, diagnoses, prescriptions, visitDate);
    loadAppointments();
  } catch (e) {
    showToast(e.message || 'Failed to save consultation', 'error');
  }
}

const prefillPatientId = sessionStorage.getItem('prefillAppointmentPatientId');
if (prefillPatientId) {
  sessionStorage.removeItem('prefillAppointmentPatientId');
  apiFetch(`/api/patients/${prefillPatientId}`).then(data => {
    const p = data?.patient;
    if (!p) return;
    openBookingModal();
    document.getElementById('selected-patient-id').value = p.patient_id;
    document.getElementById('patient-search-input').value = `${p.first_name} ${p.last_name} (${p.clinic_number})`;
    document.getElementById('selected-patient-display').textContent = `${p.first_name} ${p.last_name} selected`;
  }).catch(() => openBookingModal());
}
