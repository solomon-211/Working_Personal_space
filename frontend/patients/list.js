// Only allow admin, receptionist, and doctor roles on this page
authGuard();
checkRole(['receptionist', 'admin', 'doctor']) || (location.href = '/dashboard/index.html');

// Inject the shared header and sidebar
document.getElementById('header-slot').outerHTML = renderHeader();
document.getElementById('sidebar-slot').outerHTML = renderSidebar('patients');
applyRoleVisibility();

const currentRole = sessionStorage.getItem('role') || 'Guest';

// Keep the full patient list and the currently filtered/paginated view in memory
let allPatients = [];
let filteredPatients = [];
let currentPage = 1;
const perPage = 10;

// Fetch patients from the backend, optionally filtered by a search query
async function loadPatients(searchQuery = '') {
  const container = document.getElementById('patients-list');
  try {
    let endpoint = '/api/patients';
    if (searchQuery) endpoint += `?search=${encodeURIComponent(searchQuery)}`;
    const response = await apiFetch(endpoint);
    allPatients = response.patients || [];
    filteredPatients = allPatients;
    currentPage = 1;
    renderTable();
  } catch (error) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><span class="icon-error"></span></div>
        <div class="empty-state-title">Failed to Load Patients</div>
        <div class="empty-state-text">${error.message}</div>
        <button class="btn btn-primary" onclick="loadPatients()">Retry</button>
      </div>`;
  }
}

// Build and render the patients table for the current page
function renderTable() {
  const container = document.getElementById('patients-list');
  if (!filteredPatients.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><span class="icon-patients"></span></div>
        <div class="empty-state-title">No Patients Found</div>
        <div class="empty-state-text">Try a different search or register a new patient.</div>
        <button class="btn btn-primary" onclick="location.href = '/patients/register.html'">Register Patient</button>
      </div>`;
    document.getElementById('pagination-footer').style.display = 'none';
    return;
  }

  const paginated = paginate(filteredPatients, currentPage, perPage);
  const start = (currentPage - 1) * perPage + 1;
  const end = Math.min(currentPage * perPage, filteredPatients.length);
  document.getElementById('table-info').textContent = `Showing ${start}–${end} of ${filteredPatients.length} patients`;

  let html = `
    <table>
      <thead>
        <tr>
          <th onclick="sortTable('clinic_number')">Clinic No.</th>
          <th onclick="sortTable('first_name')">Full Name</th>
          <th onclick="sortTable('date_of_birth')">Date of Birth</th>
          <th>Gender</th><th>Phone</th><th>Insurance</th><th>Registered</th>
          <th style="text-align:center;">Actions</th>
        </tr>
      </thead>
      <tbody>`;

  paginated.items.forEach(patient => {
    const patientId = patient.patient_id || patient.id;
    html += `
      <tr>
        <td><strong>${patient.clinic_number}</strong></td>
        <td>${patient.first_name} ${patient.last_name}</td>
        <td>${formatDate(patient.date_of_birth)}</td>
        <td>${patient.gender || '—'}</td>
        <td>${patient.phone || '—'}</td>
        <td>${patient.insurance_provider || '—'}</td>
        <td>${formatDate(patient.registered_at || patient.created_at)}</td>
        <td>
          <div class="action-buttons">
            <button class="btn btn-small btn-primary" onclick="viewProfile('${patientId}')">View</button>
            ${['admin','receptionist'].includes(currentRole) ? `<button class="btn btn-small btn-secondary" onclick="editPatient('${patientId}')">Edit</button>` : ''}
          </div>
        </td>
      </tr>`;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;

  // Show or hide pagination controls depending on how many pages there are
  if (paginated.totalPages > 1) {
    document.getElementById('pagination-footer').style.display = 'flex';
    document.getElementById('pagination-info').textContent = `Page ${paginated.currentPage} of ${paginated.totalPages}`;
    document.getElementById('prev-btn').disabled = currentPage === 1;
    document.getElementById('next-btn').disabled = currentPage === paginated.totalPages;
  } else {
    document.getElementById('pagination-footer').style.display = 'none';
  }
}

function previousPage() {
  if (currentPage > 1) { currentPage--; renderTable(); window.scrollTo(0, 0); }
}

function nextPage() {
  const totalPages = Math.ceil(filteredPatients.length / perPage);
  if (currentPage < totalPages) { currentPage++; renderTable(); window.scrollTo(0, 0); }
}

// Navigate to the patient's full profile page
function viewProfile(patientId) { location.href = `/patients/profile.html?id=${patientId}`; }
function editPatient(patientId) { showToast('Edit feature coming soon', 'info'); }

// Sort the patient list by a given column when the user clicks a table header
function sortTable(column) {
  filteredPatients.sort((a, b) => {
    let aVal = a[column] || '', bVal = b[column] || '';
    return typeof aVal === 'string' ? aVal.localeCompare(bVal) : aVal - bVal;
  });
  currentPage = 1;
  renderTable();
}

// Debounce the search so we don't fire a request on every single keystroke
const debouncedSearch = debounce(async (query) => {
  if (query.length > 0) {
    allPatients = []; filteredPatients = [];
    renderTable();
    loadPatients(query);
  } else {
    loadPatients();
  }
}, 300);

document.getElementById('search-input').addEventListener('input', (e) => {
  const val = e.target.value;
  document.getElementById('search-clear').style.display = val ? 'block' : 'none';
  debouncedSearch(val);
});

// Clear the search box and reload the full patient list
function clearSearch() {
  const input = document.getElementById('search-input');
  input.value = '';
  document.getElementById('search-clear').style.display = 'none';
  input.focus();
  loadPatients();
}

// Hide the Register Patient button for roles that shouldn't see it
const registerBtn = document.getElementById('register-btn');
if (registerBtn && !['admin', 'receptionist'].includes(currentRole)) {
  registerBtn.style.display = 'none';
}

loadPatients();
