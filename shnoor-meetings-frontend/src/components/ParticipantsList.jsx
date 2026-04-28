import React from 'react';
import { X, Check, Users } from 'lucide-react';
import ProfileAvatar from './ProfileAvatar';

const ParticipantsList = React.memo(({ 
  participants, 
  joinRequests, 
  isHost, 
  onAdmit, 
  onDeny, 
  onClose 
}) => {
  return (
    <aside className="fixed inset-y-0 right-0 z-20 w-80 bg-gray-800 border-l border-gray-700 flex flex-col shadow-2xl md:relative md:rounded-xl md:my-2 md:mr-2">
      <div className="p-4 border-b border-gray-700 flex justify-between items-center">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <Users size={20} /> People
        </h2>
        <button className="text-gray-400 hover:text-white" onClick={onClose}><X size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {isHost && joinRequests.length > 0 && (
          <div>
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Join Requests</h3>
            <div className="space-y-2">
              {joinRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between p-2 bg-gray-700/50 rounded-lg">
                  <span className="text-sm font-medium truncate max-w-[120px]">{req.name}</span>
                  <div className="flex gap-1">
                    <button onClick={() => onAdmit(req.id)} className="p-1.5 bg-blue-600 rounded-md"><Check size={14} /></button>
                    <button onClick={() => onDeny(req.id)} className="p-1.5 bg-gray-600 rounded-md"><X size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">In Call</h3>
          <div className="space-y-3">
            {Object.entries(participants).map(([id, meta]) => (
              <div key={id} className="flex items-center gap-3">
                <ProfileAvatar name={meta.name} picture={meta.picture} className="w-8 h-8" textClass="text-[10px]" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{meta.name}</span>
                  <span className="text-[10px] text-gray-500">{meta.role}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
});

ParticipantsList.displayName = 'ParticipantsList';
export default ParticipantsList;
