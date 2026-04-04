import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Users, Trash2 } from 'lucide-react';

export default function UserManagement() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const formatPlayTime = (seconds: number) => {
    if (!seconds) return '0시간 0분';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}시간 ${m}분`;
    return `${m}분`;
  };

  const formatLastActive = (dateString: string) => {
    if (!dateString) return '기록 없음';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 5) return '방금 전';
    if (diffMins < 60) return `${diffMins}분 전`;
    if (diffHours < 24) return `${diffHours}시간 전`;
    if (diffDays < 7) return `${diffDays}일 전`;
    
    return date.toLocaleDateString();
  };

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      setError('사용자 목록을 불러오는데 실패했습니다.');
    } else {
      setUsers(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleDeleteUser = async (id: number) => {
    if (!window.confirm('정말 이 사용자를 삭제하시겠습니까?')) return;

    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', id);

    if (error) {
      alert('사용자 삭제에 실패했습니다.');
    } else {
      setUsers(users.filter(u => u.id !== id));
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-400" />
          회원 목록
        </h2>
        <span className="bg-slate-800 text-slate-300 px-3 py-1 rounded-full text-sm">
          총 {users.length}명
        </span>
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-400/10 p-4 rounded-xl mb-6">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 text-sm">
              <th className="pb-3 font-medium px-4">ID</th>
              <th className="pb-3 font-medium px-4">아이디 (Username)</th>
              <th className="pb-3 font-medium px-4">권한</th>
              <th className="pb-3 font-medium px-4">완성한 퍼즐</th>
              <th className="pb-3 font-medium px-4">맞춘 조각</th>
              <th className="pb-3 font-medium px-4">플레이 시간</th>
              <th className="pb-3 font-medium px-4">최근 활동</th>
              <th className="pb-3 font-medium px-4">가입일</th>
              <th className="pb-3 font-medium px-4 text-right">관리</th>
            </tr>
          </thead>
          <tbody className="text-slate-300 text-sm">
            {loading ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-slate-500">
                  로딩 중...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-slate-500">
                  가입한 회원이 없습니다.
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                  <td className="py-4 px-4 text-slate-500">{user.id}</td>
                  <td className="py-4 px-4 font-medium text-white">{user.username}</td>
                  <td className="py-4 px-4">
                    <span className={`px-2 py-1 rounded-md text-xs font-medium ${
                      user.role === 'admin' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-400'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="py-4 px-4">{user.completed_puzzles || 0}개</td>
                  <td className="py-4 px-4">{user.placed_pieces || 0}개</td>
                  <td className="py-4 px-4 text-indigo-300">{formatPlayTime(user.total_play_time)}</td>
                  <td className="py-4 px-4 text-slate-400">{formatLastActive(user.last_active_at)}</td>
                  <td className="py-4 px-4 text-slate-500">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-4 px-4 text-right">
                    {user.username !== 'admin' && (
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                        title="삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

