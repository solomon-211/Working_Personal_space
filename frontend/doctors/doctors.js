// Page bootstrap: auth + shared shell components.
authGuard();

document.getElementById('header-slot').outerHTML = renderHeader();
document.getElementById('sidebar-slot').outerHTML = renderSidebar('doctors');
applyRoleVisibility();
checkSessionTimeout();

// Page state — doctors and schedules are loaded once and reused across renders
let doctors = [];
let schedules = [];
let selectedDoctorId = null;

// Grab all the DOM elements we'll be touching throughout the page
const doctorTableBody = document.getElementById('doctor-table-body');
const doctorCount = document.getElementById('doctor-count');
const searchInput = document.getElementById('search-input');
const specializationFilter = document.getElementById('specialization-filter');
const selectedDoctorName = document.getElementById('selected-doctor-name');
const scheduleContainer = document.getElementById('schedule-container');
const summaryDoctors = document.getElementById('summary-doctors');
const summarySpecializations = document.getElementById('summary-specializations');
const summaryScheduled = document.getElementById('summary-scheduled');
const refreshButton = document.getElementById('refresh-btn');

// Returns a dash if the value is empty or whitespace — keeps the table clean
function toDisplay(value) {
	return value && String(value).trim() ? value : '—';
}

// Lowercases a value for case-insensitive comparisons
function normalize(text) {
	return String(text || '').toLowerCase();
}

// Applies the current search keyword and specialization filter to the full doctor list
function getFilteredDoctors() {
	const keyword = normalize(searchInput.value);
	const specialization = specializationFilter.value;

	return doctors.filter((doctor) => {
		const fullName = normalize(doctor.full_name);
		const phone = normalize(doctor.phone);
		const email = normalize(doctor.email);
		const spec = doctor.specialization || '';
		const matchesKeyword = !keyword || fullName.includes(keyword) || phone.includes(keyword) || email.includes(keyword);
		const matchesSpecialization = !specialization || spec === specialization;
		return matchesKeyword && matchesSpecialization;
	});
}

function renderDoctors() {
	const filteredDoctors = getFilteredDoctors();
	doctorCount.textContent = `${filteredDoctors.length} doctor${filteredDoctors.length === 1 ? '' : 's'}`;

	if (!filteredDoctors.length) {
		doctorTableBody.innerHTML = '<tr><td colspan="4" class="text-muted">No doctors match your filters.</td></tr>';
		return;
	}

	doctorTableBody.innerHTML = filteredDoctors
		.map((doctor) => {
			// Highlight the row if this doctor is currently selected
			const isActive = selectedDoctorId === doctor.doctor_id ? 'active' : '';
			return `
				<tr class="doctor-row ${isActive}" data-doctor-id="${doctor.doctor_id}">
					<td>${toDisplay(doctor.full_name)}</td>
					<td>${toDisplay(doctor.specialization)}</td>
					<td>${toDisplay(doctor.phone)}</td>
					<td>${toDisplay(doctor.email)}</td>
				</tr>
			`;
		})
		.join('');

	// Clicking a row selects that doctor and shows their schedule on the right
	doctorTableBody.querySelectorAll('tr[data-doctor-id]').forEach((row) => {
		row.addEventListener('click', () => {
			selectedDoctorId = Number(row.getAttribute('data-doctor-id'));
			renderDoctors();
			renderSchedule();
		});
	});
}

function renderSummary() {
	summaryDoctors.textContent = String(doctors.length);
	summarySpecializations.textContent = String(new Set(doctors.map((d) => d.specialization).filter(Boolean)).size);
	summaryScheduled.textContent = String(new Set(schedules.map((s) => Number(s.doctor_id))).size);
}

// Populate the specialization dropdown from whatever values exist in the loaded data
function renderSpecializationFilter() {
	const values = Array.from(new Set(doctors.map((d) => d.specialization).filter(Boolean))).sort((a, b) => a.localeCompare(b));
	specializationFilter.innerHTML =
		'<option value="">All Specializations</option>' + values.map((spec) => `<option value="${spec}">${spec}</option>`).join('');
}

function renderSchedule() {
	if (!selectedDoctorId) {
		selectedDoctorName.textContent = 'Select a doctor to view weekly schedule.';
		scheduleContainer.innerHTML = '<div class="empty-text">No doctor selected.</div>';
		return;
	}

	const doctor = doctors.find((d) => d.doctor_id === selectedDoctorId);
	const doctorSchedules = schedules.filter((s) => Number(s.doctor_id) === selectedDoctorId);
	selectedDoctorName.textContent = doctor ? `${doctor.full_name} (${doctor.specialization || 'General'})` : 'Selected doctor';

	if (!doctorSchedules.length) {
		scheduleContainer.innerHTML = '<div class="empty-text">No weekly schedule has been set for this doctor.</div>';
		return;
	}

	// Sort by day name alphabetically and render a card for each working day
	scheduleContainer.innerHTML = doctorSchedules
		.sort((a, b) => String(a.day_of_week).localeCompare(String(b.day_of_week)))
		.map(
			(slot) => `
				<div class="day-card">
					<div class="day-name">${toDisplay(slot.day_of_week)}</div>
					<div class="day-time">Starts at ${toDisplay(slot.start_time)}</div>
				</div>
			`
		)
		.join('');
}

async function loadData() {
	try {
		// Fetch doctors and their schedules at the same time to save a round trip
		const [doctorResponse, scheduleResponse] = await Promise.all([apiFetch('/api/doctors'), apiFetch('/api/doctor-schedules')]);

		doctors = doctorResponse?.doctors || [];
		schedules = scheduleResponse?.schedules || [];

		renderSummary();
		renderSpecializationFilter();
		renderDoctors();
		renderSchedule();
	} catch (error) {
		console.error(error);
		doctorTableBody.innerHTML = '<tr><td colspan="4" class="text-muted">Unable to load doctors right now.</td></tr>';
		scheduleContainer.innerHTML = '<div class="empty-text">Schedule is unavailable.</div>';
	}
}

// Wire up search, filter, and refresh — then kick off the initial load
searchInput.addEventListener('input', debounce(renderDoctors, 200));
specializationFilter.addEventListener('change', renderDoctors);
refreshButton.addEventListener('click', loadData);

loadData();
