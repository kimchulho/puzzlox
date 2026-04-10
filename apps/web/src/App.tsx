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
import { ensureRoomPasswordVerified, ROOM_PUBLIC_COLUMNS } from './lib/roomAccess';
import { decodeRoomId, roomCodeFromLocation, roomPath } from './lib/roomCode';
import { normalizePuzzleDifficulty, type PuzzleDifficulty } from './lib/puzzleDifficulty';
import type { JoinRoomMeta } from '@contracts/roomJoin';

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
  const [currentRoom, setCurrentRoom] = useState<{
    id: number;
    imageUrl: string;
    pieceCount: number;
    difficulty: PuzzleDifficulty;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(() => readStoredPuzzleUser());
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  const navigateToPath = (path: string) => {
    window.history.pushState({}, '', path);
    setPathname(path);
  };

  useEffect(() => {
    let cancelled = false;

    const syncFromLocation = () => {
      const roomParam = roomCodeFromLocation();
      const path = window.location.pathname;
      setPathname(path);

      if (!roomParam) {
        setCurrentRoom(null);
        setLoading(false);
        return;
      }

      const isNumeric = /^\d+$/.test(roomParam);
      const decodedId = isNumeric ? parseInt(roomParam, 10) : decodeRoomId(roomParam);

      if (!decodedId) {
        window.history.replaceState({}, '', '/');
        setCurrentRoom(null);
        setPathname('/');
        setLoading(false);
        return;
      }

      setLoading(true);
      const isKo = locale === 'ko';
      void (async () => {
        const { data, error } = await supabase
          .from('rooms')
          .select(ROOM_PUBLIC_COLUMNS)
          .eq('id', decodedId)
          .maybeSingle();
        if (cancelled) return;
        if (data && !error) {
          const hasPw = (data as { has_password?: boolean }).has_password === true;
          const allowed = await ensureRoomPasswordVerified(decodedId, hasPw, isKo);
          if (cancelled) return;
          if (!allowed) {
            window.history.replaceState({}, '', '/');
            setCurrentRoom(null);
            setPathname('/');
            setLoading(false);
            return;
          }
          setCurrentRoom({
            id: data.id,
            imageUrl: data.image_url,
            pieceCount: data.piece_count,
            difficulty: normalizePuzzleDifficulty((data as any).difficulty),
          });
        } else {
          window.history.replaceState({}, '', '/');
          setCurrentRoom(null);
          setPathname('/');
        }
        setLoading(false);
      })();
    };

    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    return () => {
      cancelled = true;
      window.removeEventListener('popstate', syncFromLocation);
    };
  }, [locale]);

  const handleJoinRoom = (
    roomId: number,
    imageUrl: string,
    pieceCount: number,
    difficulty: PuzzleDifficulty,
    _meta?: JoinRoomMeta
  ) => {
    const path = roomPath(roomId);
    window.history.pushState({}, '', path);
    setPathname(path);
    setCurrentRoom({
      id: roomId,
      imageUrl,
      pieceCount,
      difficulty,
    });
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
          key={currentRoom.id}
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

