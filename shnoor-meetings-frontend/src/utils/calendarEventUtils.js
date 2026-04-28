const DEFAULT_REMINDER_OFFSET_MINUTES = 5;

export function normalizeEventCategory(category) {
  const normalized = `${category || 'meetings'}`.trim().toLowerCase();
  if (normalized === 'personal') {
    return 'personal';
  }
  if (['reminder', 'reminders', 'remainder', 'remainders'].includes(normalized)) {
    return 'reminders';
  }
  return 'meetings';
}

export function getReminderOffsetMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REMINDER_OFFSET_MINUTES;
}

export function formatReminderOffsetLabel(value) {
  const minutes = getReminderOffsetMinutes(value);

  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'} before`;
  }

  return `${minutes} minute${minutes === 1 ? '' : 's'} before`;
}

export function formatEventDurationLabel(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const durationMs = end.getTime() - start.getTime();

  if (Number.isNaN(durationMs) || durationMs <= 0) {
    return '0m';
  }

  const totalMinutes = Math.round(durationMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  return `${minutes}m`;
}

export function buildMeetingLink(roomId, role = 'participant') {
  if (!roomId) {
    return '';
  }

  const baseOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${baseOrigin}/meeting/${roomId}?role=${role}`;
}
