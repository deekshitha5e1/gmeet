import { Video, Phone, CalendarDays, X, Plus, Settings, HelpCircle, LogOut, MessageSquare } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { getMeetingPreferences, getTranslator } from '../utils/meetingUtils';

export default function MeetingSidebar({ onClose, activeCategories, onToggleCategory, upcomingReminders, onCreateEvent }) {
  const [language, setLanguage] = useState(getMeetingPreferences().language);
  const activeClass = "w-full flex items-center gap-4 px-4 py-3 bg-blue-50 text-blue-700 rounded-xl font-medium transition-all group";
  const inactiveClass = "w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 text-gray-500 rounded-xl font-medium transition-all group";
  const t = useMemo(() => getTranslator(language), [language]);

  const categoryStyles = {
    personal: 'text-blue-600',
    meetings: 'text-emerald-600',
    reminders: 'text-amber-600',
    out_of_office: 'text-rose-600',
    appointment: 'text-indigo-600',
  };

  useEffect(() => {
    const syncPreferences = (event) => setLanguage((event.detail || getMeetingPreferences()).language);
    window.addEventListener('meeting-preferences-updated', syncPreferences);
    return () => window.removeEventListener('meeting-preferences-updated', syncPreferences);
  }, []);

  return (
    <aside className="fixed inset-y-0 left-0 z-[60] w-64 bg-white shadow-2xl md:shadow-none md:static md:w-64 border-r border-gray-100 flex flex-col py-6 transition-transform transform md:translate-x-0 overflow-y-auto">
      <div className="flex items-center justify-between px-4 mb-8 md:hidden">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 overflow-hidden rounded-lg">
            <img src="/logo.jpg" alt="logo" className="w-full h-full object-cover" />
          </div>
          <span className="font-bold text-gray-800 tracking-tight">Shnoor</span>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
          <X size={20} />
        </button>
      </div>

      {onCreateEvent && (
        <div className="px-4 mb-6 md:hidden">
          <button 
            onClick={() => onCreateEvent('meetings')}
            className="flex items-center justify-center gap-4 w-full bg-blue-600 text-white font-medium py-3 px-6 rounded-xl shadow-lg transition-all active:scale-95"
          >
            <Plus size={24} />
            <span className="font-semibold">Create Event</span>
          </button>
        </div>
      )}

      <nav className="space-y-2 px-2">
        <NavLink 
          to="/" 
          onClick={() => { if (window.innerWidth < 768) onClose(); }}
          className={({ isActive }) => isActive ? activeClass : inactiveClass}
        >
          <Video size={20} className="group-hover:scale-110 transition-transform" />
          <span className="inline">{t('meetings')}</span>
        </NavLink>
        
        <NavLink 
          to="/calls" 
          onClick={() => { if (window.innerWidth < 768) onClose(); }}
          className={({ isActive }) => isActive ? activeClass : inactiveClass}
        >
          <Phone size={20} className="group-hover:scale-110 transition-transform" />
          <span className="inline">{t('calls')}</span>
        </NavLink>

        <NavLink
          to="/calendar"
          onClick={() => { if (window.innerWidth < 768) onClose(); }}
          className={({ isActive }) => isActive ? activeClass : inactiveClass}
        >
          <CalendarDays size={20} className="group-hover:scale-110 transition-transform" />
          <span className="inline">{t('calendar')}</span>
        </NavLink>
      </nav>

      {activeCategories && onToggleCategory && (
        <div className="mt-8 px-4 md:hidden border-t border-gray-100 pt-6">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">My Calendars</h3>
          <div className="space-y-3">
            {[
              ['personal', 'Personal'],
              ['meetings', 'Meetings'],
              ['reminders', 'Reminders'],
              ['out_of_office', 'Out of Office'],
              ['appointment', 'Appointments'],
            ].map(([value, label]) => (
              <label key={value} className="flex items-center gap-3 px-2 py-1.5 hover:bg-gray-50 rounded-lg cursor-pointer group transition-colors">
                <input
                  type="checkbox"
                  checked={activeCategories.includes(value)}
                  onChange={() => onToggleCategory(value)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 bg-white"
                />
                <span className={`text-sm transition-colors ${categoryStyles[value]} group-hover:text-gray-900`}>
                  {label}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {upcomingReminders && upcomingReminders.length > 0 && (
        <div className="mt-8 px-4 md:hidden border-t border-gray-100 pt-6">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Upcoming</h3>
          <div className="space-y-2">
            {upcomingReminders.slice(0, 3).map((event) => (
              <div key={event.id} className="p-3 rounded-xl bg-amber-50 border border-amber-100">
                <div className="text-sm font-semibold text-amber-900 truncate">{event.title}</div>
                <div className="text-[10px] text-amber-700">{format(new Date(event.start_time), 'MMM d, h:mm a')}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto px-2 pb-6 md:hidden border-t border-gray-100 pt-6">
        <button className={inactiveClass} onClick={onClose}>
          <Settings size={20} />
          <span>Settings</span>
        </button>
        <button className={inactiveClass} onClick={onClose}>
          <HelpCircle size={20} />
          <span>Help</span>
        </button>
        <button className={inactiveClass} onClick={onClose}>
          <MessageSquare size={20} />
          <span>Feedback</span>
        </button>
        <button 
          className="w-full flex items-center gap-4 px-4 py-3 text-red-600 hover:bg-red-50 rounded-xl font-medium transition-all group" 
          onClick={() => { localStorage.removeItem('user'); window.location.reload(); }}
        >
          <LogOut size={20} />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
