import React, { useState, useMemo } from 'react';
import { X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ImageSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: any[];
  selectedUrl: string;
  onSelect: (url: string) => void;
  onDeleteImage?: (image: any) => Promise<void> | void;
  isKo?: boolean;
  /** 앱인토스 로비: 밝은 패널·토스 블루 */
  tossStyling?: boolean;
}

export const ImageSelectorModal: React.FC<ImageSelectorModalProps> = ({
  isOpen,
  onClose,
  images,
  selectedUrl,
  onSelect,
  onDeleteImage,
  isKo = true,
  tossStyling = false,
}) => {
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [pendingDeleteImage, setPendingDeleteImage] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const categories = useMemo(() => {
    const cats = new Set(images.map(img => img.category || 'Uncategorized'));
    return ['All', ...Array.from(cats)].sort();
  }, [images]);

  const filteredImages = useMemo(() => {
    if (activeCategory === 'All') return images;
    return images.filter(img => (img.category || 'Uncategorized') === activeCategory);
  }, [images, activeCategory]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`absolute inset-0 backdrop-blur-sm ${tossStyling ? "bg-slate-900/40" : "bg-slate-950/80"}`}
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className={`relative w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] border ${
            tossStyling
              ? "bg-white border-[#D9E8FF]"
              : "bg-slate-900 border-slate-800"
          }`}
        >
          {/* Header */}
          <div
            className={`flex items-center justify-between p-4 border-b ${
              tossStyling ? "border-[#D9E8FF] bg-[#F4F8FF]" : "border-slate-800 bg-slate-900/50"
            }`}
          >
            <h3 className={`text-lg font-semibold ${tossStyling ? "text-slate-900" : "text-white"}`}>
              Select Puzzle Image
            </h3>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${
                tossStyling
                  ? "text-[#2F6FE4] hover:bg-[#EAF2FF]"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <X size={20} />
            </button>
          </div>

          {/* Categories */}
          <div
            className={`p-4 border-b overflow-x-auto custom-scrollbar flex gap-2 ${
              tossStyling ? "border-[#D9E8FF] bg-white" : "border-slate-800"
            }`}
          >
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  activeCategory === cat
                    ? tossStyling
                      ? "bg-[#2F6FE4] text-white"
                      : "bg-indigo-500 text-white"
                    : tossStyling
                      ? "bg-[#F4F8FF] text-slate-600 border border-[#D9E8FF] hover:border-[#2F6FE4]/40"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Image Grid */}
          <div className={`flex-1 overflow-y-auto p-4 custom-scrollbar ${tossStyling ? "bg-white" : ""}`}>
            {filteredImages.length === 0 ? (
              <div
                className={`flex flex-col items-center justify-center h-40 ${tossStyling ? "text-slate-500" : "text-slate-500"}`}
              >
                <p>No images found in this category.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {filteredImages.map(img => (
                  <div 
                    key={img.id}
                    onClick={() => {
                      onSelect(img.url);
                      onClose();
                    }}
                    className={`group relative aspect-video rounded-xl overflow-hidden cursor-pointer border-2 transition-all duration-200 ${
                      selectedUrl === img.url
                        ? tossStyling
                          ? "border-[#2F6FE4] shadow-[0_0_15px_rgba(47,111,228,0.35)] scale-[0.98]"
                          : "border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)] scale-[0.98]"
                        : tossStyling
                          ? "border-[#D9E8FF] hover:border-[#2F6FE4]/50 hover:scale-[1.02]"
                          : "border-transparent hover:border-slate-600 hover:scale-[1.02]"
                    }`}
                  >
                    <img 
                      src={img.url} 
                      alt={img.title || `${img.category} - ${img.style}`} 
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                    
                    <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-4 group-hover:translate-y-0 transition-transform duration-200">
                      <p className="text-white text-sm font-medium truncate">
                        {img.title || `${img.category} - ${img.style}`}
                      </p>
                    </div>

                    {selectedUrl === img.url && (
                      <div
                        className={`absolute top-2 right-2 text-white p-1 rounded-full shadow-lg ${
                          tossStyling ? "bg-[#2F6FE4]" : "bg-indigo-500"
                        }`}
                      >
                        <Check size={16} />
                      </div>
                    )}
                    {img.__gallerySource === "custom" && onDeleteImage ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeleteImage(img);
                        }}
                        className={`absolute left-2 top-2 rounded-md px-2 py-1 text-[11px] font-semibold ${
                          tossStyling
                            ? "bg-red-500 text-white hover:bg-red-600"
                            : "bg-red-500/90 text-white hover:bg-red-500"
                        }`}
                      >
                        {isKo ? "삭제" : "Delete"}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
          {pendingDeleteImage ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
              <div
                className={`absolute inset-0 ${tossStyling ? "bg-black/35" : "bg-black/55"}`}
                onClick={() => {
                  if (!isDeleting) setPendingDeleteImage(null);
                }}
              />
              <div
                className={`relative w-full max-w-md rounded-2xl p-5 shadow-2xl ${
                  tossStyling ? "border border-[#D9E8FF] bg-white" : "border border-slate-700 bg-slate-900"
                }`}
              >
                <h4 className={`text-base font-bold ${tossStyling ? "text-slate-900" : "text-white"}`}>
                  {isKo ? "사진을 삭제할까요?" : "Delete this image?"}
                </h4>
                <p className={`mt-2 text-sm leading-relaxed ${tossStyling ? "text-slate-600" : "text-slate-300"}`}>
                  {isKo
                    ? "삭제하면 이 사진으로 만든 퍼즐방도 함께 사라집니다. 이 작업은 되돌릴 수 없습니다."
                    : "Deleting this image also removes puzzle rooms created with it. This cannot be undone."}
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => setPendingDeleteImage(null)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium ${
                      tossStyling
                        ? "border border-[#D9E8FF] bg-white text-slate-700 hover:bg-[#F4F8FF]"
                        : "border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
                    } disabled:opacity-50`}
                  >
                    {isKo ? "취소" : "Cancel"}
                  </button>
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={async () => {
                      if (!onDeleteImage) return;
                      try {
                        setIsDeleting(true);
                        await onDeleteImage(pendingDeleteImage);
                        setPendingDeleteImage(null);
                      } finally {
                        setIsDeleting(false);
                      }
                    }}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold text-white ${
                      tossStyling ? "bg-[#f04452] hover:bg-[#e03644]" : "bg-red-500 hover:bg-red-600"
                    } disabled:opacity-50`}
                  >
                    {isDeleting ? (isKo ? "삭제 중..." : "Deleting...") : isKo ? "삭제하기" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
