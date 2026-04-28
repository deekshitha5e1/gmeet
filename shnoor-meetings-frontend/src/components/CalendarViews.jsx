import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addDays, startOfDay, addHours, isAfter } from 'date-fns';

const eventTheme = {
  personal: {
    month: 'bg-blue-50 border-blue-600 text-blue-800',
    block: 'bg-blue-50 border-blue-600 text-blue-900',
    text: 'text-blue-700',
  },
  meetings: {
    month: 'bg-emerald-50 border-emerald-600 text-emerald-800',
    block: 'bg-emerald-50 border-emerald-600 text-emerald-900',
    text: 'text-emerald-700',
  },
  reminders: {
    month: 'bg-amber-50 border-amber-500 text-amber-900',
    block: 'bg-amber-50 border-amber-500 text-amber-950 ring-1 ring-amber-200',
    text: 'text-amber-700',
  },
};

function getEventTheme(event) {
  return eventTheme[event.category || 'meetings'] || eventTheme.meetings;
}

function isPendingReminder(event) {
  return (event.category || 'meetings') === 'reminders' && isAfter(new Date(event.start_time), new Date());
}

export function MonthView({ currentDate, events, onDateClick }) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const weekDays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white">
      <div className="grid grid-cols-7 border-b border-gray-100">
        {weekDays.map(day => (
          <div key={day} className="py-2 text-center text-[11px] font-bold text-gray-500 tracking-wider">
            {day}
          </div>
        ))}
      </div>
      <div className="flex-1 grid grid-cols-7 grid-rows-5 overflow-auto">
        {days.map((day) => {
          const dayEvents = events.filter(e => isSameDay(new Date(e.start_time), day));
          return (
            <div
              key={day.toString()}
              onClick={() => onDateClick(day)}
              className={`min-h-[120px] border-r border-b border-gray-100 p-1 hover:bg-gray-50 transition-colors cursor-pointer group
                ${!isSameMonth(day, monthStart) ? 'bg-gray-50/30' : ''}
              `}
            >
              <div className="flex flex-col items-center">
                <span className={`text-xs font-semibold w-7 h-7 flex items-center justify-center rounded-full mt-1 mb-1
                  ${isSameDay(day, new Date()) ? 'bg-blue-600 text-white shadow-md' : 'text-gray-600 group-hover:text-blue-600 transition-colors'}
                `}>
                  {format(day, 'd')}
                </span>
                <div className="w-full flex flex-col gap-1 px-1">
                  {dayEvents.map(event => {
                    const theme = getEventTheme(event);
                    return (
                      <div 
                        key={event.id} 
                        className={`text-[10px] px-2 py-1 border-l-4 rounded-sm truncate transition-colors font-medium ${theme.month} ${isPendingReminder(event) ? 'shadow-sm' : ''}`}
                        title={`${event.title} - ${event.description || ''}`}
                      >
                        {event.title}
                        {isPendingReminder(event) ? ` • ${format(new Date(event.start_time), 'h:mm a')}` : ''}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function WeekView({ currentDate, events, onSlotClick }) {
  const startDate = startOfWeek(currentDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(startDate, i));
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      <div className="flex border-b border-gray-100 ml-16">
        {days.map(day => (
          <div key={day.toString()} className="flex-1 py-4 text-center border-r border-gray-50">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{format(day, 'EEE')}</div>
            <div className={`text-xl font-medium mt-1 w-10 h-10 flex items-center justify-center rounded-full mx-auto
              ${isSameDay(day, new Date()) ? 'bg-blue-600 text-white shadow-md' : 'text-gray-700'}
            `}>
              {format(day, 'd')}
            </div>
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        <div className="flex flex-col relative">
          {hours.map(hour => (
            <div key={hour} className="flex h-20 border-b border-gray-50">
              <div className="w-16 flex-shrink-0 text-[10px] text-gray-400 text-right pr-4 font-medium">
                {hour === 0 ? '' : format(addHours(startOfDay(new Date()), hour), 'h a')}
              </div>
              {days.map(day => {
                const slotStart = addHours(startOfDay(day), hour);
                const slotEvents = events.filter(e => {
                  const eventStart = new Date(e.start_time);
                  return isSameDay(eventStart, day) && eventStart.getHours() === hour;
                });
                
                return (
                  <div 
                    key={day.toString() + hour} 
                    onClick={() => onSlotClick(slotStart)}
                    className="flex-1 border-r border-gray-50 relative hover:bg-blue-50/30 cursor-pointer transition-colors"
                  >
                    {slotEvents.map(event => {
                      const theme = getEventTheme(event);
                      return (
                        <div 
                          key={event.id}
                          className={`absolute inset-x-1 top-1 border-l-4 rounded-sm p-1.5 z-10 shadow-sm ${theme.block}`}
                        >
                          <div className="text-[10px] font-bold truncate">{event.title}</div>
                          <div className={`text-[9px] font-medium ${theme.text}`}>
                            {format(new Date(event.start_time), 'h:mm a')}
                            {isPendingReminder(event) ? ' - Reminder' : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DayView({ currentDate, events, onSlotClick }) {
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      <div className="flex border-b border-gray-100 ml-16">
        <div className="flex-1 py-8 text-center text-gray-700">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">{format(currentDate, 'EEEE')}</div>
          <div className={`text-4xl font-semibold mt-2 w-16 h-16 flex items-center justify-center rounded-full mx-auto
            ${isSameDay(currentDate, new Date()) ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-800'}
          `}>
            {format(currentDate, 'd')}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="flex flex-col relative">
          {hours.map(hour => {
            const slotStart = addHours(startOfDay(currentDate), hour);
            const slotEvents = events.filter(e => {
              const eventStart = new Date(e.start_time);
              return isSameDay(eventStart, currentDate) && eventStart.getHours() === hour;
            });

            return (
              <div key={hour} className="flex h-24 border-b border-gray-50">
                <div className="w-16 flex-shrink-0 text-xs text-gray-400 text-right pr-6 pt-1 font-medium">
                  {hour === 0 ? '' : format(addHours(startOfDay(new Date()), hour), 'h a')}
                </div>
                <div 
                  onClick={() => onSlotClick(slotStart)}
                  className="flex-1 relative hover:bg-blue-50/20 cursor-pointer transition-colors"
                >
                  {slotEvents.map(event => {
                    const theme = getEventTheme(event);
                    return (
                      <div 
                        key={event.id}
                        className={`absolute inset-x-4 top-2 border-l-4 rounded-lg p-4 z-10 shadow-md transform hover:scale-[1.01] transition-all ${theme.block}`}
                      >
                        <div className="text-sm font-bold">{event.title}</div>
                        <div className={`text-xs mt-1 font-medium italic opacity-90 ${theme.text}`}>
                          {format(new Date(event.start_time), 'h:mm a')}
                          {event.description ? ` - ${event.description}` : ''}
                        </div>
                        {isPendingReminder(event) && (
                          <div className="text-[11px] font-semibold text-amber-800 mt-2">
                            Pending reminder for {format(new Date(event.start_time), 'MMM d, yyyy')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
