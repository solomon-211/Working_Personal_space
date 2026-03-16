if (sessionStorage.getItem('role')) {
  window.location.href = '/dashboard/index.html';
}

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

async function handleLogin() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();

  document.getElementById('username-error').classList.remove('show');
  document.getElementById('password-error').classList.remove('show');
  document.getElementById('login-error').style.display = 'none';

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

    sessionStorage.setItem('role', data.user.role);
    sessionStorage.setItem('name', data.user.username);
    sessionStorage.setItem('login_time', Date.now());
    if (data.user.doctor_id) sessionStorage.setItem('doctor_id', data.user.doctor_id);

    window.location.href = '/dashboard/index.html';
  } catch (error) {
    const errorBox = document.getElementById('login-error');
    errorBox.textContent = error.message;
    errorBox.style.display = 'block';
    button.disabled = false;
    button.textContent = 'Login';
  }
}

document.addEventListener('keydown', event => {
  if (event.key === 'Enter') handleLogin();
});
