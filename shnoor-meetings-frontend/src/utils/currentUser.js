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
  // If user is logged in, ensure they have a meetingUserId
  if (user) {
    if (user.meetingUserId) return user;
    return persistUser({
      ...user,
      meetingUserId: crypto.randomUUID(),
    });
  }

  // If user is a guest, ensure they have a persistent guestId
  const guestUserStr = localStorage.getItem('guest_user');
  if (guestUserStr) {
    try {
      return JSON.parse(guestUserStr);
    } catch (e) {
      console.error('Failed to parse guest user', e);
    }
  }

  const newGuest = {
    name: 'Guest',
    meetingUserId: crypto.randomUUID(),
    isGuest: true
  };
  localStorage.setItem('guest_user', JSON.stringify(newGuest));
  return newGuest;
}

export function getCurrentUser() {
  return ensureFrontendUserId(parseStoredUser());
}
