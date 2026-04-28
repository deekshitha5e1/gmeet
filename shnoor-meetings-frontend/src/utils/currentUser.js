function parseStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch (error) {
    console.error('Failed to parse stored user.', error);
    return null;
  }
}

function persistUser(user) {
  localStorage.setItem('user', JSON.stringify(user));
  window.dispatchEvent(new Event('storage'));
  return user;
}

export function ensureFrontendUserId(user) {
  if (!user) {
    return null;
  }

  if (user.meetingUserId) {
    return user;
  }

  return persistUser({
    ...user,
    meetingUserId: crypto.randomUUID(),
  });
}

export function getCurrentUser() {
  return ensureFrontendUserId(parseStoredUser());
}
