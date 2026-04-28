const MEETING_PREFERENCES_KEY = 'shnoor_meeting_preferences';
const CALL_HISTORY_KEY = 'shnoor_call_history';

const defaultPreferences = {
  microphoneId: 'default',
  cameraId: 'default',
  microphoneEnabled: true,
  cameraEnabled: true,
  hardwareAcceleration: true,
  language: 'english',
  theme: 'light',
};

const translations = {
  english: {
    meetings: 'Meetings',
    calls: 'Calls',
    calendar: 'Calendar',
    help: 'Need help?',
    helpSubtext: 'Quick guidance for participants and hosts.',
    joinMeetingHelp: 'Join a meeting',
    joinMeetingHelpText: 'Open the meeting link, check your mic and camera, then ask to join if the host is admitting participants.',
    presentHelp: 'Present your screen',
    presentHelpText: 'Use the screen share button in the meeting controls. Your presentation will move to the main stage for everyone.',
    moreAssistance: 'Need more assistance?',
    chatbotSupport: 'Open chatbot support',
    settings: 'Settings',
    audioVideo: 'Audio & Video Devices',
    defaultMicrophone: 'Default Microphone',
    defaultCamera: 'Default Camera',
    systemDefault: 'System Default',
    hardwareAcceleration: 'Hardware Acceleration',
    enabledForPerformance: 'Enabled for better performance',
    disabled: 'Disabled',
    language: 'Language',
    theme: 'Theme',
    english: 'English',
    hindi: 'Hindi',
    lightTheme: 'White Theme',
    darkTheme: 'Black Theme',
    on: 'On',
    off: 'Off',
    select: 'Select',
  },
  hindi: {
    meetings: 'मीटिंग्स',
    calls: 'कॉल्स',
    calendar: 'कैलेंडर',
    help: 'मदद चाहिए?',
    helpSubtext: 'होस्ट और प्रतिभागियों के लिए तुरंत सहायता।',
    joinMeetingHelp: 'मीटिंग में शामिल हों',
    joinMeetingHelpText: 'मीटिंग लिंक खोलें, अपना माइक और कैमरा जांचें, फिर होस्ट की अनुमति का इंतजार करें।',
    presentHelp: 'अपनी स्क्रीन साझा करें',
    presentHelpText: 'मीटिंग कंट्रोल में स्क्रीन शेयर बटन का उपयोग करें। आपकी प्रस्तुति सबके लिए मुख्य स्क्रीन पर दिखेगी।',
    moreAssistance: 'और सहायता चाहिए?',
    chatbotSupport: 'चैटबॉट सहायता खोलें',
    settings: 'सेटिंग्स',
    audioVideo: 'ऑडियो और वीडियो डिवाइस',
    defaultMicrophone: 'डिफॉल्ट माइक्रोफोन',
    defaultCamera: 'डिफॉल्ट कैमरा',
    systemDefault: 'सिस्टम डिफॉल्ट',
    hardwareAcceleration: 'हार्डवेयर एक्सेलरेशन',
    enabledForPerformance: 'बेहतर प्रदर्शन के लिए सक्षम',
    disabled: 'अक्षम',
    language: 'भाषा',
    theme: 'थीम',
    english: 'अंग्रेज़ी',
    hindi: 'हिंदी',
    lightTheme: 'सफेद थीम',
    darkTheme: 'काली थीम',
    on: 'चालू',
    off: 'बंद',
    select: 'चुनें',
  },
};

export function getMeetingPreferences() {
  try {
    const stored = localStorage.getItem(MEETING_PREFERENCES_KEY);
    return stored ? { ...defaultPreferences, ...JSON.parse(stored) } : defaultPreferences;
  } catch (error) {
    console.error('Failed to read meeting preferences:', error);
    return defaultPreferences;
  }
}

export function saveMeetingPreferences(nextPreferences) {
  const mergedPreferences = {
    ...getMeetingPreferences(),
    ...nextPreferences,
  };

  localStorage.setItem(MEETING_PREFERENCES_KEY, JSON.stringify(mergedPreferences));
  applyThemePreference(mergedPreferences.theme);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('meeting-preferences-updated', { detail: mergedPreferences }));
  }

  return mergedPreferences;
}

export function getPreferredMediaConstraints() {
  const preferences = getMeetingPreferences();

  return {
    audio: !preferences.microphoneEnabled
      ? false
      : preferences.microphoneId && preferences.microphoneId !== 'default'
      ? { deviceId: { exact: preferences.microphoneId } }
      : true,
    video: !preferences.cameraEnabled
      ? false
      : preferences.cameraId && preferences.cameraId !== 'default'
      ? { deviceId: { exact: preferences.cameraId } }
      : true,
  };
}

export function applyThemePreference(theme = getMeetingPreferences().theme) {
  if (typeof document === 'undefined') {
    return;
  }

  document.body.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

export function getTranslator(language = getMeetingPreferences().language) {
  return (key) => translations[language]?.[key] || translations.english[key] || key;
}

export function getCallHistory() {
  try {
    const stored = localStorage.getItem(CALL_HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to read call history:', error);
    return [];
  }
}

function saveCallHistory(history) {
  localStorage.setItem(CALL_HISTORY_KEY, JSON.stringify(history));
}

export function upsertCallHistoryEntry(entry) {
  const history = getCallHistory();
  const index = history.findIndex((item) => item.sessionId === entry.sessionId);

  if (index >= 0) {
    history[index] = { ...history[index], ...entry };
  } else {
    history.unshift(entry);
  }

  saveCallHistory(history);
}

export function closeCallHistoryEntry(sessionId, exitTime = new Date().toISOString()) {
  const history = getCallHistory();
  const index = history.findIndex((item) => item.sessionId === sessionId);

  if (index === -1) {
    return;
  }

  const entry = history[index];
  history[index] = {
    ...entry,
    exitTime,
    durationMs: new Date(exitTime).getTime() - new Date(entry.entryTime).getTime(),
  };

  saveCallHistory(history);
}

export function removeCallHistoryEntry(sessionId) {
  const history = getCallHistory().filter((item) => item.sessionId !== sessionId);
  saveCallHistory(history);
}

export function formatDateTime(value) {
  if (!value) {
    return 'In progress';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(durationMs = 0) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

export function getPreJoinMediaState(roomId) {
  if (!roomId) {
    return { audioEnabled: true, videoEnabled: true };
  }

  try {
    const stored = sessionStorage.getItem(`meeting_prejoin_media_${roomId}`);
    return stored ? { audioEnabled: true, videoEnabled: true, ...JSON.parse(stored) } : { audioEnabled: true, videoEnabled: true };
  } catch (error) {
    console.error('Failed to read pre-join media state:', error);
    return { audioEnabled: true, videoEnabled: true };
  }
}

export function savePreJoinMediaState(roomId, nextState) {
  if (!roomId) {
    return;
  }

  const mergedState = {
    ...getPreJoinMediaState(roomId),
    ...nextState,
  };

  sessionStorage.setItem(`meeting_prejoin_media_${roomId}`, JSON.stringify(mergedState));
}
