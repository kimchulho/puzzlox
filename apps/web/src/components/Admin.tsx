import React, { useState } from 'react';
import { ArrowLeft, ShieldAlert, Users, Image as ImageIcon } from 'lucide-react';
import { motion } from 'motion/react';
import UserManagement from './UserManagement';
import ImageManagement from './ImageManagement';

export default function Admin({ onBack }: { onBack: () => void }) {
  const [activeTab, setActiveTab] = useState<'users' | 'images'>('users');

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center py-12 px-4 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-4xl"
      >
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <ShieldAlert className="w-8 h-8 text-indigo-400" />
              관리자 대시보드
            </h1>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-8">
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-medium transition-colors ${
              activeTab === 'users' ? 'bg-indigo-500 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
            }`}
          >
            <Users className="w-5 h-5" />
            회원 관리
          </button>
          <button
            onClick={() => setActiveTab('images')}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-medium transition-colors ${
              activeTab === 'images' ? 'bg-indigo-500 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
            }`}
          >
            <ImageIcon className="w-5 h-5" />
            이미지 관리
          </button>
        </div>

        {activeTab === 'users' ? <UserManagement /> : <ImageManagement />}
      </motion.div>
    </div>
  );
}
