import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Trash2, Image as ImageIcon } from 'lucide-react';
import AdminImageUpload from './AdminImageUpload';

export default function ImageManagement() {
  const [images, setImages] = useState<any[]>([]);

  const fetchImages = async () => {
    const { data, error } = await supabase
      .from('puzzle_images')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching images:', error);
    } else {
      setImages(data || []);
    }
  };

  useEffect(() => {
    fetchImages();
  }, []);

  const handleDeleteImage = async (id: number, url: string) => {
    if (!window.confirm('정말 이 이미지를 삭제하시겠습니까?')) return;

    // 1. Delete from storage
    const path = url.split('/').pop();
    if (path) {
        await supabase.storage.from('puzzle_images').remove([`public/${path}`, `private/${path}`]);
    }

    // 2. Delete from DB
    const { error } = await supabase
      .from('puzzle_images')
      .delete()
      .eq('id', id);

    if (error) {
      alert('이미지 삭제에 실패했습니다.');
    } else {
      setImages(images.filter(img => img.id !== id));
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
      <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-6">
        <ImageIcon className="w-5 h-5 text-indigo-400" />
        이미지 관리
      </h2>
      <AdminImageUpload onUploadSuccess={fetchImages} />
      <div className="overflow-x-auto mt-6">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 text-sm">
              <th className="pb-3 font-medium px-4">Image</th>
              <th className="pb-3 font-medium px-4">Title</th>
              <th className="pb-3 font-medium px-4">Category</th>
              <th className="pb-3 font-medium px-4">Style</th>
              <th className="pb-3 font-medium px-4 text-right">관리</th>
            </tr>
          </thead>
          <tbody className="text-slate-300 text-sm">
            {images.map((img) => (
              <tr key={img.id} className="border-b border-slate-800/50">
                <td className="py-4 px-4"><img src={img.url} alt={img.title} className="w-16 h-16 object-cover rounded" /></td>
                <td className="py-4 px-4">{img.title}</td>
                <td className="py-4 px-4">{img.category}</td>
                <td className="py-4 px-4">{img.style}</td>
                <td className="py-4 px-4 text-right">
                  <button onClick={() => handleDeleteImage(img.id, img.url)} className="text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
