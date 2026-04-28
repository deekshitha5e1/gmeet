import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Star, Shield, MessageSquare, RefreshCcw, Home } from 'lucide-react';
import { motion } from 'framer-motion';

export default function LeftMeetingPage() {
  const { id: roomId } = useParams();
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(60);
  const [rating, setRating] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate('/');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [navigate]);

  const dashOffset = (countdown / 60) * 100;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-gray-800 font-sans relative">
      {/* Countdown Loader in Top Left */}
      <div className="absolute top-8 left-8 flex items-center gap-4 z-50">
        <div className="relative w-12 h-12">
          <svg className="w-full h-full transform -rotate-90">
            <circle
              cx="24"
              cy="24"
              r="20"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
              className="text-gray-200"
            />
            <circle
              cx="24"
              cy="24"
              r="20"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
              strokeDasharray="125.66"
              strokeDashoffset={125.66 * (1 - countdown / 60)}
              className="text-blue-600 transition-all duration-1000 ease-linear"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-600">
            {countdown}
          </span>
        </div>
        <span className="text-sm font-medium text-gray-500">Returning to home screen</span>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-xl w-full text-center space-y-12"
      >
        <h1 className="text-4xl md:text-5xl font-normal text-gray-700">You've left the meeting</h1>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            onClick={() => navigate(`/meeting/${roomId}`)}
            className="w-full sm:w-auto px-8 py-2.5 bg-white border border-gray-300 rounded-full text-blue-600 font-semibold hover:bg-gray-50 transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <RefreshCcw size={18} />
            Rejoin
          </button>
          <button
            onClick={() => navigate('/')}
            className="w-full sm:w-auto px-8 py-2.5 bg-blue-600 text-white rounded-full font-semibold hover:bg-blue-700 transition-all shadow-md flex items-center justify-center gap-2"
          >
            <Home size={18} />
            Return to home screen
          </button>
        </div>

        {/* Feedback Card */}
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 space-y-6">
          <p className="text-gray-700 font-medium">How was the audio and video?</p>
          <div className="flex items-center justify-center gap-4">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onMouseEnter={() => setRating(star)}
                onClick={() => setRating(star)}
                className="transition-transform transform hover:scale-125 focus:outline-none"
              >
                <Star
                  size={40}
                  className={`${
                    star <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'
                  } transition-colors duration-200`}
                />
              </button>
            ))}
          </div>
          <div className="flex justify-between text-xs font-bold text-gray-400 uppercase tracking-widest px-4">
            <span>Very bad</span>
            <span>Very good</span>
          </div>
        </div>

        {/* Security Card */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-start gap-6 text-left">
          <div className="bg-blue-50 p-4 rounded-xl text-blue-600">
            <Shield size={32} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-800 mb-1">Your meeting is safe</h3>
            <p className="text-sm text-gray-500 leading-relaxed">
              No one can join a meeting unless invited or admitted by the host
            </p>
            <button className="text-blue-600 text-sm font-bold mt-3 hover:underline">Learn more</button>
          </div>
        </div>
      </motion.div>

      {/* Footer */}
      <div className="absolute bottom-8 left-8">
        <button className="flex items-center gap-2 text-gray-500 hover:text-gray-800 transition-colors text-sm font-medium">
          <MessageSquare size={18} />
          Feedback
        </button>
      </div>
    </div>
  );
}
