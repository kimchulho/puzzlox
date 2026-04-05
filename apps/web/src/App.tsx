/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import PuzzleBoard from './components/PuzzleBoard';
import Lobby from './components/Lobby';
import Auth from './components/Auth';
import Admin from './components/Admin';
import TermsOfService from './components/TermsOfService';
import UserDashboard from './components/UserDashboard';
import { supabase } from './lib/supabaseClient';
import { encodeRoomId, decodeRoomId } from './lib/roomCode';
import { normalizePuzzleDifficulty, type PuzzleDifficulty } from './lib/puzzleDifficulty';

function readStoredPuzzleUser(): unknown | null {
  try {
    const raw = localStorage.getItem('puzzle_user');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem('puzzle_user');
    return null;
  }
}

export default function App() {
  const [locale, setLocale] = useState<'ko' | 'en'>(() => {
    const saved = localStorage.getItem('webpuzzle_locale');
    if (saved === 'ko' || saved === 'en') return saved;
    return 'ko';
  });
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [currentRoom, setCurrentRoom] = useState<{id: number, imageUrl: string, pieceCount: number, difficulty: PuzzleDifficulty} | null>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(() => readStoredPuzzleUser());
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  const navigateToPath = (path: string) => {
    window.history.pushState({}, '', path);
    setPathname(path);
  };

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    
    if (roomParam) {
      const isNumeric = /^\d+$/.test(roomParam);
      const decodedId = isNumeric ? parseInt(roomParam, 10) : decodeRoomId(roomParam);

      if (decodedId) {
        supabase.from('rooms').select('*').eq('id', decodedId).single().then(({ data, error }) => {
          if (data && !error) {
            setCurrentRoom({
              id: data.id,
              imageUrl: data.image_url,
              pieceCount: data.piece_count,
              difficulty: normalizePuzzleDifficulty((data as any).difficulty),
            });
          } else {
            window.history.replaceState({}, '', '/');
          }
          setLoading(false);
        });
      } else {
        window.history.replaceState({}, '', '/');
        setLoading(false);
      }
    } else {
      setLoading(false);
    }

    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');
      if (!roomParam) {
        setCurrentRoom(null);
      } else {
        const isNumeric = /^\d+$/.test(roomParam);
        const decodedId = isNumeric ? parseInt(roomParam, 10) : decodeRoomId(roomParam);
        if (decodedId) {
          supabase.from('rooms').select('*').eq('id', decodedId).single().then(({ data, error }) => {
            if (data && !error) {
              setCurrentRoom({
                id: data.id,
                imageUrl: data.image_url,
                pieceCount: data.piece_count,
                difficulty: normalizePuzzleDifficulty((data as any).difficulty),
              });
            }
          });
        }
      }
    };
    
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleJoinRoom = (roomId: number, imageUrl: string, pieceCount: number, difficulty: PuzzleDifficulty) => {
    const roomCode = encodeRoomId(roomId);
    window.history.pushState({}, '', `/?room=${roomCode}`);
    setCurrentRoom({ id: roomId, imageUrl, pieceCount, difficulty });
  };

  const handleLeaveRoom = () => {
    window.history.pushState({}, '', '/');
    setCurrentRoom(null);
  };

  const handleLogout = () => {
    localStorage.removeItem('puzzle_user');
    setUser(null);
    setShowAdmin(false);
  };

  const toggleLocale = () => {
    setLocale((prev) => {
      const next = prev === 'ko' ? 'en' : 'ko';
      localStorage.setItem('webpuzzle_locale', next);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="h-screen w-screen bg-slate-950 flex items-center justify-center text-white">
        <div className="text-2xl font-bold animate-pulse">Loading...</div>
      </div>
    );
  }

  if (pathname === '/terms') {
    return <TermsOfService onBack={() => navigateToPath('/')} />;
  }

  const publicProfileMatch = pathname.match(/^\/u\/([^/]+)\/?$/);
  const publicProfileUsername = publicProfileMatch
    ? decodeURIComponent(publicProfileMatch[1])
    : null;

  if (pathname === '/dashboard' || pathname === '/dashboard/') {
    return (
      <UserDashboard
        mode="self"
        onBack={() => navigateToPath('/')}
        onJoinRoom={handleJoinRoom}
        locale={locale}
        user={user}
        setUser={setUser}
      />
    );
  }

  if (publicProfileUsername) {
    return (
      <UserDashboard
        mode="public"
        publicUsername={publicProfileUsername}
        onBack={() => navigateToPath('/')}
        onJoinRoom={handleJoinRoom}
        locale={locale}
      />
    );
  }

  if (showAuth) {
    return (
      <Auth
        onLogin={(u) => { setUser(u); setShowAuth(false); }}
        onClose={() => setShowAuth(false)}
        onOpenTerms={() => {
          navigateToPath('/terms');
          setShowAuth(false);
        }}
      />
    );
  }

  if (showAdmin && user?.role === 'admin') {
    return <Admin onBack={() => setShowAdmin(false)} />;
  }

  if (currentRoom) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-slate-900 relative">
        <PuzzleBoard 
          roomId={currentRoom.id} 
          imageUrl={currentRoom.imageUrl} 
          pieceCount={currentRoom.pieceCount} 
          difficulty={currentRoom.difficulty}
          onBack={handleLeaveRoom}
          user={user}
          setUser={setUser}
          locale={locale}
        />
      </div>
    );
  }

  return (
    <Lobby
      onJoinRoom={handleJoinRoom}
      user={user}
      onLogout={handleLogout}
      onAdmin={() => setShowAdmin(true)}
      onLoginClick={() => setShowAuth(true)}
      onOpenTerms={() => navigateToPath('/terms')}
      onOpenDashboard={() => navigateToPath('/dashboard')}
      locale={locale}
      onToggleLocale={toggleLocale}
    />
  );
}

