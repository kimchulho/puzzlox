import React, { useState } from 'react';
import { LogIn, UserPlus, Lock, User, X } from 'lucide-react';
import { motion } from 'motion/react';

export default function Auth({
  onLogin,
  onClose,
  onOpenTerms,
}: {
  onLogin: (user: any) => void;
  onClose?: () => void;
  onOpenTerms?: () => void;
}) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const trimmedId = username.trim().toLowerCase();
    if (!isLogin && trimmedId.startsWith('toss_')) {
      setError("'toss_'로 시작하는 아이디는 사용할 수 없습니다. (토스 연동 전용 접두사입니다.)");
      setLoading(false);
      return;
    }

    try {
      const endpoint = isLogin ? '/api/auth/web/login' : '/api/auth/web/signup';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json();

      if (!response.ok) {
        setError(result?.message || '인증 처리 중 오류가 발생했습니다.');
        return;
      }

      const { accessToken, user } = result;
      if (!accessToken || !user) {
        setError('로그인 응답이 올바르지 않습니다.');
        return;
      }

      localStorage.setItem('puzzle_access_token', accessToken);
      localStorage.setItem('puzzle_user', JSON.stringify(user));
      onLogin(user);
    } catch (err) {
      console.error(err);
      setError('서버 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative">
      {onClose && (
        <button 
          onClick={onClose} 
          className="absolute top-6 right-6 p-2 bg-slate-900 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
      )}
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl"
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <User className="w-8 h-8 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            {isLogin ? '로그인' : '회원가입'}
          </h1>
          <p className="text-slate-400 text-sm">
            웹 퍼즐에 오신 것을 환영합니다!
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">아이디</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <User className="h-5 w-5 text-slate-500" />
              </div>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="block w-full pl-10 bg-slate-950 border border-slate-800 rounded-xl p-3 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                placeholder="아이디를 입력하세요"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">비밀번호</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="h-5 w-5 text-slate-500" />
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full pl-10 bg-slate-950 border border-slate-800 rounded-xl p-3 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                placeholder="비밀번호를 입력하세요"
              />
            </div>
          </div>

          {error && (
            <div className="text-red-400 text-sm text-center bg-red-400/10 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors mt-6"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : isLogin ? (
              <><LogIn className="w-5 h-5" /> 로그인</>
            ) : (
              <><UserPlus className="w-5 h-5" /> 가입하기</>
            )}
          </button>
        </form>

        <div className="mt-6 text-center space-y-3">
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }}
            className="text-slate-400 hover:text-indigo-400 text-sm transition-colors block w-full"
          >
            {isLogin ? '계정이 없으신가요? 회원가입' : '이미 계정이 있으신가요? 로그인'}
          </button>
          {onOpenTerms && (
            <button
              type="button"
              onClick={onOpenTerms}
              className="text-slate-500 hover:text-slate-300 text-xs underline underline-offset-2"
            >
              서비스 이용약관
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
