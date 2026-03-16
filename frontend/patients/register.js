// Only admin and receptionist can register new patients
authGuard();
checkRole(['receptionist', 'admin']) || (location.href = '/dashboard/index.html');

// Inject the shared header and sidebar
document.getElementById('header-slot').outerHTML = renderHeader();
document.getElementById('sidebar-slot').outerHTML = renderSidebar('register');
applyRoleVisibility();
checkSessionTimeout();

// Track which step of the registration wizard we're on
let currentStep = 1;
let patientData = {};
let registeredClinicNumber = null;
let registeredPatientId = null;

// Switch to a specific step and update the step indicators accordingly
function setStep(step) {
  currentStep = step;
  document.getElementById('step-1').classList.toggle('active', step === 1);
  document.getElementById('step-2').classList.toggle('active', step === 2);
  for (let i = 1; i <= 2; i++) {
    const ind = document.getElementById(`step-${i}-indicator`);
    ind.classList.remove('active', 'completed');
    if (i < step) ind.classList.add('completed');
    else if (i === step) ind.classList.add('active');
  }
  // Show the right buttons for each step
  document.getElementById('back-btn').style.display   = step === 1 ? 'none' : '';
  document.getElementById('next-btn').style.display   = step === 2 ? 'none' : '';
  document.getElementById('submit-btn').style.display = step === 2 ? '' : 'none';
  if (step === 2) generateClinicNumber();
}

function previousStep() { if (currentStep > 1) setStep(currentStep - 1); }

// Validate step 1 before moving to step 2
function nextStep() {
  if (!validateStep1()) return;
  saveStep1();
  setStep(2);
}

// Save the step 1 form values into memory so they survive the step transition
function saveStep1() {
  patientData = {
    firstName:     document.getElementById('firstName').value,
    lastName:      document.getElementById('lastName').value,
    date_of_birth: document.getElementById('date_of_birth').value,
    gender:        document.getElementById('gender').value,
    phone:         document.getElementById('phone').value,
    email:         document.getElementById('email').value,
    address:       document.getElementById('address').value
  };
}

// Check that all required fields in step 1 are filled in correctly
function validateStep1() {
  const fields = {
    firstName:     document.getElementById('firstName').value.trim(),
    lastName:      document.getElementById('lastName').value.trim(),
    date_of_birth: document.getElementById('date_of_birth').value,
    phone:         document.getElementById('phone').value.trim(),
    email:         document.getElementById('email').value.trim()
  };
  const errors = {};
  if (!fields.firstName)     errors.firstName     = 'First name is required';
  if (!fields.lastName)      errors.lastName      = 'Last name is required';
  if (!fields.date_of_birth) errors.date_of_birth = 'Date of birth is required';
  if (!fields.phone)         errors.phone         = 'Phone is required';
  else if (!validatePhone(fields.phone)) errors.phone = 'Phone must be at least 7 characters';
  if (fields.email && !validateEmail(fields.email)) errors.email = 'Invalid email format';

  ['firstName', 'lastName', 'date_of_birth', 'phone', 'email'].forEach(key => {
    const errEl = document.getElementById(`${key}-error`);
    const input = document.getElementById(key);
    if (errors[key]) {
      if (errEl) errEl.textContent = errors[key];
      if (input) input.classList.add('error');
    } else {
      if (errEl) errEl.textContent = '';
      if (input) input.classList.remove('error');
    }
  });
  return Object.keys(errors).length === 0;
}

// Generate a random clinic number in the format CLN-XXXX for the preview
function generateClinicNumber() {
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  registeredClinicNumber = `CLN-${random}`;
  document.getElementById('clinic-number-preview').textContent = registeredClinicNumber;
}

// Submit the full registration form to the backend
async function submitForm() {
  if (!validateStep1()) { setStep(1); return; }
  if (!document.getElementById('consent').checked) {
    document.getElementById('consent-error').textContent = 'Consent is required to register the patient';
    return;
  }
  document.getElementById('consent-error').textContent = '';
  saveStep1();

  // Build the payload using the backend's expected field names
  const payload = {
    first_name:         patientData.firstName,
    last_name:          patientData.lastName,
    date_of_birth:      patientData.date_of_birth,
    gender:             patientData.gender,
    phone:              patientData.phone,
    email:              patientData.email,
    address:            patientData.address,
    blood_type:         document.getElementById('bloodType').value,
    emergency_contact:  [document.getElementById('emergency_contact_name').value, document.getElementById('emergency_contact_phone').value].filter(Boolean).join(' | '),
    insurance_provider: document.getElementById('insurance').value,
    national_id:        document.getElementById('nationalId').value,
    clinic_number:      document.getElementById('clinicNumber').value || registeredClinicNumber
  };

  const btn = document.getElementById('submit-btn');
  loadingState(btn, true);
  try {
    const response = await apiFetch('/api/patients', { method: 'POST', body: JSON.stringify(payload) });
    registeredClinicNumber = response.clinic_number;
    registeredPatientId    = response.id ?? response.patient_id;
    document.getElementById('success-clinic-number').textContent = registeredClinicNumber;
    document.getElementById('success-modal').classList.add('show');
  } catch (error) {
    showToast('Failed to register patient: ' + error.message, 'error');
  } finally {
    loadingState(btn, false);
  }
}

// Go to the newly registered patient's profile page
function viewPatientProfile() {
  if (registeredPatientId) location.href = `/patients/profile.html?id=${registeredPatientId}`;
}

// Pre-fill the appointment booking page with this patient and redirect there
function schedulePatientAppointment() {
  if (registeredPatientId) sessionStorage.setItem('prefillAppointmentPatientId', String(registeredPatientId));
  location.href = '/appointments/index.html';
}

// Reset the form so the user can register another patient right away
function registerAnother() {
  document.getElementById('success-modal').classList.remove('show');
  ['firstName','lastName','date_of_birth','gender','phone','email','address',
   'bloodType','emergency_contact_name','emergency_contact_phone','insurance','nationalId','clinicNumber']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('consent').checked = false;
  setStep(1);
}

// Start on step 1 when the page loads
setStep(1);
