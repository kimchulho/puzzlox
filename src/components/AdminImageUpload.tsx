import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Upload } from 'lucide-react';

const AdminImageUpload = ({ onUploadSuccess }: { onUploadSuccess?: () => void }) => {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [style, setStyle] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleUpload = async () => {
    if (!file || !title || !category || !style) return;
    setUploading(true);

    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random()}.${fileExt}`;
    const filePath = `public/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('puzzle_images')
      .upload(filePath, file);

    if (uploadError) {
      console.error('Error uploading image:', uploadError);
      setUploading(false);
      return;
    }

    const { data } = supabase.storage.from('puzzle_images').getPublicUrl(filePath);
    
    const { error: insertError } = await supabase.from('puzzle_images').insert([
      { title, url: data.publicUrl, category, style, is_public: true }
    ]);

    if (insertError) {
      console.error('Error inserting image into DB:', insertError);
      alert(`이미지 저장에 실패했습니다: ${insertError.message}`);
      setUploading(false);
      return;
    }

    setUploading(false);
    alert('Image uploaded successfully!');
    if (onUploadSuccess) onUploadSuccess();
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-white">
      <h2 className="text-xl font-bold mb-4">Upload Public Image</h2>
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="mb-4" />
      <input type="text" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 mb-2" />
      <input type="text" placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 mb-2" />
      <input type="text" placeholder="Style" value={style} onChange={(e) => setStyle(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 mb-4" />
      <button onClick={handleUpload} disabled={uploading} className="w-full bg-indigo-500 py-3 rounded-xl">
        {uploading ? 'Uploading...' : 'Upload'}
      </button>
    </div>
  );
};

export default AdminImageUpload;
