import { BrowserRouter as Router, Navigate, Routes, Route } from 'react-router-dom';
import { useEffect, useState } from 'react';
import LandingPage from './pages/LandingPage';
import MeetingRoom from './pages/MeetingRoom';
import CalendarPage from './pages/CalendarPage';
import CallsPage from './pages/CallsPage';
import LeftMeetingPage from './pages/LeftMeetingPage';
import LobbyPage from './pages/LobbyPage';
import LoginPage from './pages/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';
import { applyThemePreference, getMeetingPreferences } from './utils/meetingUtils';


function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user')));

  useEffect(() => {
    applyThemePreference(getMeetingPreferences().theme);
  }, []);

  useEffect(() => {
    const syncUser = () => {
      setUser(() => JSON.parse(localStorage.getItem('user')));
    };

    window.addEventListener('storage', syncUser);
    window.addEventListener('focus', syncUser);

    return () => {
      window.removeEventListener('storage', syncUser);
      window.removeEventListener('focus', syncUser);
    };
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/login" element={!user ? <LoginPage /> : <Navigate to="/" replace />} />
        <Route path="/" element={<ProtectedRoute><LandingPage /></ProtectedRoute>} />
        <Route path="/meeting/:id" element={<ProtectedRoute><LobbyPage /></ProtectedRoute>} />
        <Route path="/room/:id" element={<ProtectedRoute><MeetingRoom /></ProtectedRoute>} />
        <Route path="/calendar" element={<ProtectedRoute><CalendarPage /></ProtectedRoute>} />
        <Route path="/calls" element={<ProtectedRoute><CallsPage /></ProtectedRoute>} />
        <Route path="/left-meeting/:id" element={<ProtectedRoute><LeftMeetingPage /></ProtectedRoute>} />


      </Routes>
    </Router>
  );
}

export default App;
