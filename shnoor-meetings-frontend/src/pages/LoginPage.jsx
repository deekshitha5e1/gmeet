import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { saveUser } from '../services/userService';
import { ensureFrontendUserId } from '../utils/currentUser';
import loginIllustration from '../assets/login-illustration.png';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user'));
    if (user) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  // No URL-param callback needed — Firebase handles the popup flow client-side

  const persistUser = async (userData) => {
    const normalizedUser = ensureFrontendUserId(userData);

    try {
      await saveUser(normalizedUser);
    } catch (error) {
      console.error('Error saving user:', error);
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();

    if (!email) {
      alert('Enter your Gmail');
      return;
    }

    const userData = {
      id: email,
      name: email.split('@')[0],
      email,
      picture: `https://ui-avatars.com/api/?name=${encodeURIComponent(email)}&background=random`,
    };

    await persistUser(userData);
    navigate('/');
  };

  const handleGoogleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const firebaseUser = result.user;

      const userData = {
        id: firebaseUser.uid,
        name: firebaseUser.displayName || firebaseUser.email.split('@')[0],
        email: firebaseUser.email,
        picture: firebaseUser.photoURL ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(firebaseUser.displayName || firebaseUser.email)}&background=random`,
      };

      await persistUser(userData);
      navigate('/', { replace: true });
    } catch (error) {
      console.error('Google sign-in failed:', error);
      if (error.code !== 'auth/popup-closed-by-user') {
        alert(`Google sign-in failed: ${error.message}`);
      }
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50 font-sans text-slate-900">
      {/* Left Side: Illustration (Hidden on Mobile) */}
      <div className="hidden lg:flex lg:w-1/2 bg-white items-center justify-center p-12">
        <div className="max-w-xl text-center">
          <img 
            src={loginIllustration} 
            alt="Collaborative Meeting" 
            className="w-full h-auto mb-8 rounded-2xl shadow-2xl"
          />
          <h2 className="text-3xl font-bold text-slate-800 mb-4">Elevate Your Meetings</h2>
          <p className="text-slate-600 text-lg">
            Experience seamless collaboration with high-quality video, 
            real-time sharing, and professional tools designed for modern teams.
          </p>
        </div>
      </div>

      {/* Right Side: Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md bg-white rounded-3xl p-8 sm:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.05)] border border-slate-100">
          <div className="mb-10">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Welcome Back</h1>
            <p className="text-slate-500">Please enter your details to sign in.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5 ml-1">Email Address</label>
              <input
                type="email"
                placeholder="name@company.com"
                value={email}
                required
                onChange={(event) => setEmail(event.target.value)}
                className="w-full px-4 py-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-slate-900 placeholder:text-slate-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5 ml-1">Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                required
                onChange={(event) => setPassword(event.target.value)}
                className="w-full px-4 py-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-slate-900 placeholder:text-slate-400"
              />
            </div>

            <div className="flex items-center justify-between text-sm py-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <span className="text-slate-600">Remember me</span>
              </label>
              <a href="#" className="font-medium text-blue-600 hover:text-blue-700 transition-colors">Forgot password?</a>
            </div>

            <button
              type="submit"
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-4 rounded-xl transition-all shadow-lg active:scale-[0.98]"
            >
              Sign In
            </button>
          </form>

          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-100"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-4 text-slate-400 font-medium">OR CONTINUE WITH</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 active:scale-[0.98]"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Google Account
          </button>

          <p className="mt-8 text-center text-sm text-slate-500">
            Don't have an account? <a href="#" className="font-semibold text-blue-600 hover:text-blue-700 transition-colors">Sign up for free</a>
          </p>
        </div>
      </div>
    </div>
  );
}

