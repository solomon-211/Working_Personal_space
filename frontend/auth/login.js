// If the user is already logged in, skip the login page and go straight to the dashboard
if (sessionStorage.getItem('role')) {
  window.location.href = '/dashboard/index.html';
}

// Toggle the password field between visible and hidden text
function togglePassword() {
  const pwd = document.getElementById('password');
  const btn = document.getElementById('toggle-pwd');
  if (pwd.type === 'password') {
    pwd.type = 'text';
    btn.textContent = 'Hide';
  } else {
    pwd.type = 'password';
    btn.textContent = 'Show';
  }
}

// Handle the login form submission
async function handleLogin() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();

  // Clear any previous error messages before trying again
  document.getElementById('username-error').classList.remove('show');
  document.getElementById('password-error').classList.remove('show');
  document.getElementById('login-error').style.display = 'none';

  // Make sure both fields are filled in before sending the request
  let isValid = true;
  if (!username) {
    document.getElementById('username-error').classList.add('show');
    document.getElementById('username').classList.add('error');
    isValid = false;
  }
  if (!password) {
    document.getElementById('password-error').classList.add('show');
    document.getElementById('password').classList.add('error');
    isValid = false;
  }
  if (!isValid) return;

  // Disable the button and show a spinner while the request is in flight
  const button = document.getElementById('login-btn');
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span> Logging in...';

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Invalid credentials');

    // Save the user's role and name so other pages can use them
    // Note: the login route only returns username and role, not doctor_id
    sessionStorage.setItem('role', data.user.role);
    sessionStorage.setItem('name', data.user.username);
    sessionStorage.setItem('login_time', Date.now());

    window.location.href = '/dashboard/index.html';
  } catch (error) {
    const errorBox = document.getElementById('login-error');
    errorBox.textContent = error.message;
    errorBox.style.display = 'block';
    button.disabled = false;
    button.textContent = 'Login';
  }
}

// Allow the user to press Enter to submit the login form
document.addEventListener('keydown', event => {
  if (event.key === 'Enter') handleLogin();
});
