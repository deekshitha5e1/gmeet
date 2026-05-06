import { useMemo, useState } from 'react';
import { Plus, ChevronLeft, ChevronRight, Bell, ChevronDown, Calendar, CheckCircle, Coffee, Briefcase } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

const categoryStyles = {
  personal: 'text-blue-600',
  meetings: 'text-emerald-600',
  reminders: 'text-amber-600',
};

export default function CalendarSidebar({
  currentDate,
  onDateSelect,
  onCreateEvent,
  activeCategories,
  onToggleCategory,
  upcomingReminders,
}) {
  const [displayDate, setDisplayDate] = useState(currentDate);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const createOptions = [
    { label: 'Event', icon: Calendar, category: 'meetings', color: 'text-blue-600' },
    { label: 'Task', icon: CheckCircle, category: 'reminders', color: 'text-blue-600' },
  ];

  const handlePrevMonth = (e) => {
    e.stopPropagation();
    setDisplayDate(subMonths(displayDate, 1));
  };

  const handleNextMonth = (e) => {
    e.stopPropagation();
    setDisplayDate(addMonths(displayDate, 1));
  };

  const reminderPreview = useMemo(() => upcomingReminders.slice(0, 4), [upcomingReminders]);
  
  const renderMiniCalendar = () => {
    const monthStart = startOfMonth(displayDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const days = eachDayOfInterval({ start: startDate, end: endDate });
    const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    return (
      <div className="mt-6 px-2">
        <div className="flex items-center justify-between mb-4 px-2">
          <span className="text-sm font-medium text-gray-600">
            {format(displayDate, 'MMMM yyyy')}
          </span>
          <div className="flex gap-1">
            <button onClick={handlePrevMonth} className="p-1 hover:bg-gray-100 rounded-full"><ChevronLeft size={16} /></button>
            <button onClick={handleNextMonth} className="p-1 hover:bg-gray-100 rounded-full"><ChevronRight size={16} /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {weekDays.map(day => (
            <div key={day} className="text-[10px] text-center font-bold text-gray-500 py-1">
              {day}
            </div>
          ))}
          {days.map(day => (
            <button
              key={day.toString()}
              onClick={() => onDateSelect(day)}
              className={`text-xs w-7 h-7 flex items-center justify-center rounded-full transition-colors mx-auto
                ${!isSameMonth(day, monthStart) ? 'text-gray-400' : 'text-gray-600'}
                ${isSameDay(day, currentDate) ? 'bg-blue-600 !text-white' : 'hover:bg-gray-100'}
                ${isSameDay(day, new Date()) && !isSameDay(day, currentDate) ? 'text-blue-500 border border-blue-400' : ''}
              `}
            >
              {format(day, 'd')}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <aside className="w-64 border-r border-gray-100 bg-white flex flex-col p-4 shadow-sm overflow-y-auto">
      <div className="relative mb-8">
        <button 
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex items-center gap-3 bg-white hover:bg-gray-50 text-gray-700 font-medium py-2.5 px-5 rounded-full shadow-md border border-gray-100 transition-all transform hover:shadow-lg active:scale-95 group min-w-[140px]"
        >
          <Plus size={24} className="text-blue-600 group-hover:rotate-90 transition-transform duration-300" />
          <span className="text-sm font-semibold mr-2">Create</span>
          <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        <AnimatePresence>
          {isDropdownOpen && (
            <>
              <div 
                className="fixed inset-0 z-10" 
                onClick={() => setIsDropdownOpen(false)} 
              />
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="absolute top-full left-0 mt-2 w-56 bg-white rounded-xl shadow-2xl border border-gray-100 py-2 z-20 overflow-hidden"
              >
                {createOptions.map((option) => (
                  <button
                    key={option.label}
                    onClick={() => {
                      onCreateEvent(option.category);
                      setIsDropdownOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                  >
                    <option.icon size={18} className="text-gray-400" />
                    <span>{option.label}</span>
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {renderMiniCalendar()}

      <div className="mt-10 px-2">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-6 px-1">My Calendars</h3>
        <div className="space-y-4">
          {[
            ['personal', 'Personal'],
            ['meetings', 'Meetings'],
            ['reminders', 'Reminders'],
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

      <div className="mt-10 px-2">
        <div className="flex items-center gap-2 mb-4">
          <Bell size={16} className="text-amber-500" />
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Pending Reminders</h3>
        </div>
        <div className="space-y-3">
          {reminderPreview.length === 0 ? (
            <div className="text-xs text-gray-500 rounded-xl border border-dashed border-gray-200 px-3 py-4">
              No pending reminders.
            </div>
          ) : (
            reminderPreview.map((event) => (
              <button
                key={event.id}
                onClick={() => onDateSelect(new Date(event.start_time))}
                className="w-full text-left rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 hover:bg-amber-100 transition-colors"
              >
                <div className="text-sm font-semibold text-amber-900 truncate">{event.title}</div>
                <div className="text-xs text-amber-700 mt-1">{format(new Date(event.start_time), 'MMM d, yyyy - h:mm a')}</div>
                {event.description && (
                  <div className="text-xs text-amber-800/80 mt-1 line-clamp-2">{event.description}</div>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
