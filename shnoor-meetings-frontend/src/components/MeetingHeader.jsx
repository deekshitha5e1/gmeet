import { Menu, HelpCircle, MessageSquare, Settings, Grid, User, X, Info, Monitor, Mic, Video, Check, LogOut } from 'lucide-react';
import { format } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { getMeetingPreferences, getTranslator, saveMeetingPreferences } from '../utils/meetingUtils';

export default function MeetingHeader({ onOpenChatbot, toggleSidebar }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentTime, setCurrentTime] = useState(() => format(new Date(), 'HH:mm - EEE, d MMM'));
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  
  const [availableDevices, setAvailableDevices] = useState({ microphones: [], cameras: [] });
  const [expandedPicker, setExpandedPicker] = useState(null);
  const [meetingPreferences, setMeetingPreferences] = useState(getMeetingPreferences);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const user = JSON.parse(localStorage.getItem('user') || 'null');

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTime(format(new Date(), 'HH:mm - EEE, d MMM'));
    }, 1000);

    const syncPreferences = (event) => {
      setMeetingPreferences(event.detail || getMeetingPreferences());
    };

    window.addEventListener('meeting-preferences-updated', syncPreferences);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('meeting-preferences-updated', syncPreferences);
    };
  }, []);

  useEffect(() => {
    if (!isSettingsOpen || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    const loadDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAvailableDevices({
          microphones: devices.filter((device) => device.kind === 'audioinput'),
          cameras: devices.filter((device) => device.kind === 'videoinput'),
        });
      } catch (error) {
        console.error('Failed to enumerate devices:', error);
      }
    };

    loadDevices();
  }, [isSettingsOpen]);

  const t = useMemo(() => getTranslator(meetingPreferences.language), [meetingPreferences.language]);

  const updatePreference = (nextValue) => {
    const updatedPreferences = saveMeetingPreferences(nextValue);
    setMeetingPreferences(updatedPreferences);
  };

  const handleOpenChatbot = () => {
    if (onOpenChatbot) {
      onOpenChatbot();
      return;
    }

    navigate('/?chatbot=1');
  };

  const navigationItems = [
    { to: '/', label: t('meetings') },
    { to: '/calls', label: t('calls') },
    { to: '/calendar', label: t('calendar') },
  ];

  const handleLogout = () => {
    localStorage.removeItem("user");
    window.location.href = "/login";
  };

  return (
    <>
      <header className="flex items-center justify-between px-4 py-2 bg-white text-gray-700 border-b border-gray-100 h-16 shadow-sm relative z-20">
        <div className="flex items-center gap-2">
        <button
          onClick={toggleSidebar}
          className="p-2 hover:bg-gray-100 rounded-full"
        >
          <Menu size={24} />
        </button>

        <div className="flex items-center gap-2 ml-1">
          <div className="w-10 h-10 overflow-hidden">
            <img src="/logo.jpg" alt="logo" className="w-full h-full" />
          </div>

          <span className="text-lg md:text-xl text-gray-600">
            Shnoor{" "}
            <span className="text-gray-500 hidden sm:inline">
              International LLC Meetings
            </span>
          </span>
        </div>
      </div>

        <div className="flex items-center gap-1">
          <div className="text-gray-500 mr-4 font-medium hidden lg:block">
            {currentTime}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsHelpOpen(true)}
              className="p-2.5 hover:bg-gray-100 rounded-full text-gray-600 transition-colors"
              title={t('help')}
            >
              <HelpCircle size={22} />
            </button>
            <button
              onClick={handleOpenChatbot}
              className="p-2.5 hover:bg-gray-100 rounded-full text-gray-600 transition-colors"
              title="Open chatbot"
            >
              <MessageSquare size={22} />
            </button>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2.5 hover:bg-gray-100 rounded-full text-gray-600 transition-colors"
              title={t('settings')}
            >
              <Settings size={22} />
            </button>
          </div>

          <div className="flex items-center gap-2 ml-4">
            <button
              className="p-2.5 hover:bg-gray-100 rounded-full text-gray-600 transition-colors"
              onClick={() => navigate(location.pathname.startsWith('/calendar') ? '/' : '/calendar')}
              title={t('calendar')}
            >
              <Grid size={22} />
            </button>
            <div className="relative ml-2">
              <button
                className="w-10 h-10 bg-emerald-600 rounded-full flex items-center justify-center border-2 border-white shadow-sm cursor-pointer overflow-hidden"
                onClick={() => setIsProfileOpen((prev) => !prev)}
              >
                {user?.picture ? (
                  <img src={user.picture} alt={user.name || 'User'} className="w-full h-full object-cover" />
                ) : (
                  <User size={20} className="text-white" />
                )}
              </button>

              {isProfileOpen && (
                <div className="absolute right-0 top-12 w-72 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-emerald-600 overflow-hidden flex items-center justify-center">
                      {user?.picture ? (
                        <img src={user.picture} alt={user.name || 'User'} className="w-full h-full object-cover" />
                      ) : (
                        <User size={22} className="text-white" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-gray-800 truncate">{user?.name || 'Guest User'}</div>
                      <div className="text-sm text-gray-500 truncate">{user?.email || 'No email'}</div>
                    </div>
                  </div>

                  <button
                    onClick={handleLogout}
                    className="mt-4 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    <LogOut size={16} />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      


      {isHelpOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-xl shadow-2xl">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-semibold text-gray-800">{t('help')}</h2>
                <p className="text-sm text-gray-500 mt-1">{t('helpSubtext')}</p>
              </div>
              <button onClick={() => setIsHelpOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition">
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="font-medium text-gray-800 mb-1">{t('joinMeetingHelp')}</div>
                <div className="text-sm text-gray-500">{t('joinMeetingHelpText')}</div>
              </div>
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="font-medium text-gray-800 mb-1">{t('presentHelp')}</div>
                <div className="text-sm text-gray-500">{t('presentHelpText')}</div>
              </div>
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="font-medium text-gray-800 mb-1">{t('moreAssistance')}</div>
                <button
                  onClick={() => {
                    setIsHelpOpen(false);
                    handleOpenChatbot();
                  }}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  <MessageSquare size={16} />
                  {t('chatbotSupport')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl animate-in fade-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-6 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-3">
                <Settings className="text-blue-600" size={24} />
                <h2 className="text-2xl font-semibold text-gray-800">{t('settings')}</h2>
              </div>
              <button onClick={() => setIsSettingsOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition">
                <X size={24} />
              </button>
            </div>

            <div className="space-y-6">
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-start gap-3">
                <Info className="text-blue-600 mt-1 flex-shrink-0" size={20} />
                <div>
                  <h3 className="font-semibold text-blue-900 mb-1">Shnoor International LLC Platform</h3>
                  <p className="text-blue-800 text-sm leading-relaxed">
                    Welcome to the secure corporate meeting environment. All connections are encrypted via WebRTC.
                    Current Version: 1.0.4-beta.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-gray-700 font-medium border-b pb-2">{t('audioVideo')}</h3>

                <DevicePreferenceCard
                  icon={<Mic className="text-gray-500" size={20} />}
                  title={t('defaultMicrophone')}
                  subtitle={availableDevices.microphones.find((device) => device.deviceId === meetingPreferences.microphoneId)?.label || t('systemDefault')}
                  expanded={expandedPicker === 'microphone'}
                  onTogglePicker={() => setExpandedPicker((prev) => prev === 'microphone' ? null : 'microphone')}
                  toggleLabel={meetingPreferences.microphoneEnabled ? t('on') : t('off')}
                  toggleActive={meetingPreferences.microphoneEnabled}
                  onToggleEnabled={() => updatePreference({ microphoneEnabled: !meetingPreferences.microphoneEnabled })}
                  options={[
                    { deviceId: 'default', label: t('systemDefault') },
                    ...availableDevices.microphones.map((device) => ({
                      deviceId: device.deviceId,
                      label: device.label || `Microphone ${device.deviceId.slice(0, 4)}`,
                    })),
                  ]}
                  selectedId={meetingPreferences.microphoneId}
                  onSelect={(deviceId) => {
                    updatePreference({ microphoneId: deviceId });
                    setExpandedPicker(null);
                  }}
                  selectLabel={t('select')}
                />

                <DevicePreferenceCard
                  icon={<Video className="text-gray-500" size={20} />}
                  title={t('defaultCamera')}
                  subtitle={availableDevices.cameras.find((device) => device.deviceId === meetingPreferences.cameraId)?.label || t('systemDefault')}
                  expanded={expandedPicker === 'camera'}
                  onTogglePicker={() => setExpandedPicker((prev) => prev === 'camera' ? null : 'camera')}
                  toggleLabel={meetingPreferences.cameraEnabled ? t('on') : t('off')}
                  toggleActive={meetingPreferences.cameraEnabled}
                  onToggleEnabled={() => updatePreference({ cameraEnabled: !meetingPreferences.cameraEnabled })}
                  options={[
                    { deviceId: 'default', label: t('systemDefault') },
                    ...availableDevices.cameras.map((device) => ({
                      deviceId: device.deviceId,
                      label: device.label || `Camera ${device.deviceId.slice(0, 4)}`,
                    })),
                  ]}
                  selectedId={meetingPreferences.cameraId}
                  onSelect={(deviceId) => {
                    updatePreference({ cameraId: deviceId });
                    setExpandedPicker(null);
                  }}
                  selectLabel={t('select')}
                />

                <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg bg-gray-50">
                  <div className="flex items-center gap-3">
                    <Monitor className="text-gray-500" size={20} />
                    <div>
                      <div className="text-sm font-medium text-gray-800">{t('hardwareAcceleration')}</div>
                      <div className="text-xs text-gray-500">
                        {meetingPreferences.hardwareAcceleration ? t('enabledForPerformance') : t('disabled')}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => updatePreference({ hardwareAcceleration: !meetingPreferences.hardwareAcceleration })}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${meetingPreferences.hardwareAcceleration ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                  >
                    {meetingPreferences.hardwareAcceleration ? t('on') : t('off')}
                  </button>
                </div>
              </div>

              <OptionRow
                title={t('language')}
                value={meetingPreferences.language === 'hindi' ? t('hindi') : t('english')}
                options={[
                  { value: 'english', label: t('english') },
                  { value: 'hindi', label: t('hindi') },
                ]}
                selectedValue={meetingPreferences.language}
                onSelect={(value) => updatePreference({ language: value })}
              />

              <OptionRow
                title={t('theme')}
                value={meetingPreferences.theme === 'dark' ? t('darkTheme') : t('lightTheme')}
                options={[
                  { value: 'light', label: t('lightTheme') },
                  { value: 'dark', label: t('darkTheme') },
                ]}
                selectedValue={meetingPreferences.theme}
                onSelect={(value) => updatePreference({ theme: value })}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DevicePreferenceCard({
  icon,
  title,
  subtitle,
  expanded,
  onTogglePicker,
  toggleLabel,
  toggleActive,
  onToggleEnabled,
  options,
  selectedId,
  onSelect,
  selectLabel,
}) {
  return (
    <div className="border border-gray-200 rounded-lg bg-gray-50">
      <div className="flex items-center justify-between p-3 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {icon}
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-800">{title}</div>
            <div className="text-xs text-gray-500 truncate">{subtitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleEnabled}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${toggleActive ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            {toggleLabel}
          </button>
          <button onClick={onTogglePicker} className="text-sm text-blue-600 font-medium hover:underline">
            {selectLabel}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-200 px-3 py-2 space-y-1 bg-white rounded-b-lg">
          {options.map((option) => (
            <button
              key={option.deviceId}
              onClick={() => onSelect(option.deviceId)}
              className="w-full flex items-center justify-between rounded-md px-3 py-2 text-sm text-left hover:bg-gray-50 transition-colors"
            >
              <span className="text-gray-700">{option.label}</span>
              {selectedId === option.deviceId && <Check size={16} className="text-blue-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OptionRow({ title, value, options, selectedValue, onSelect }) {
  return (
    <div className="border border-gray-200 rounded-lg bg-gray-50 p-3">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-medium text-gray-800">{title}</div>
          <div className="text-xs text-gray-500">{value}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => onSelect(option.value)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${selectedValue === option.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}