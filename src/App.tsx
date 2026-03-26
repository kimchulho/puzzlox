/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import PuzzleBoard from './components/PuzzleBoard';
import Lobby from './components/Lobby';
import { supabase } from './lib/supabaseClient';

export default function App() {
  const [currentRoom, setCurrentRoom] = useState<{id: number, imageUrl: string, pieceCount: number} | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');
    
    if (roomId) {
      supabase.from('pixi_rooms').select('*').eq('id', roomId).single().then(({ data, error }) => {
        if (data && !error) {
          setCurrentRoom({ id: data.id, imageUrl: data.image_url, pieceCount: data.piece_count });
        } else {
          window.history.replaceState({}, '', '/');
        }
        setLoading(false);
      });
    } else {
      setLoading(false);
    }

    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const roomId = params.get('room');
      if (!roomId) {
        setCurrentRoom(null);
      }
    };
    
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleJoinRoom = (roomId: number, imageUrl: string, pieceCount: number) => {
    window.history.pushState({}, '', `/?room=${roomId}`);
    setCurrentRoom({ id: roomId, imageUrl, pieceCount });
  };

  const handleLeaveRoom = () => {
    window.history.pushState({}, '', '/');
    setCurrentRoom(null);
  };

  if (loading) {
    return (
      <div className="h-screen w-screen bg-slate-950 flex items-center justify-center text-white">
        <div className="text-2xl font-bold animate-pulse">Loading...</div>
      </div>
    );
  }

  if (currentRoom) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-slate-900 relative">
        <PuzzleBoard 
          roomId={currentRoom.id} 
          imageUrl={currentRoom.imageUrl} 
          pieceCount={currentRoom.pieceCount} 
          onBack={handleLeaveRoom}
        />
      </div>
    );
  }

  return <Lobby onJoinRoom={handleJoinRoom} />;
}
