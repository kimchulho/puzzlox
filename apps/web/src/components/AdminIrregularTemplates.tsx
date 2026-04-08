import React, { useState, useEffect } from "react";
import { apiUrl } from "../lib/apiBase";
import { Layers, Upload } from "lucide-react";

type TemplateRow = {
  id: number;
  name: string;
  cut_kind: string;
  piece_count: number;
  assembly_count: number;
  svg_url: string;
  created_at?: string;
};

export default function AdminIrregularTemplates() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [name, setName] = useState("");
  const [cutKind, setCutKind] = useState<"generic" | "image_specific">("generic");
  const [assemblyHint, setAssemblyHint] = useState<"auto" | "1" | "2">("auto");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const token = () =>
    typeof localStorage !== "undefined" ? localStorage.getItem("puzzle_access_token") : null;

  const load = async () => {
    const res = await fetch(apiUrl("/api/irregular-templates"));
    const j = (await res.json().catch(() => ({}))) as { templates?: TemplateRow[] };
    setTemplates(Array.isArray(j.templates) ? j.templates : []);
  };

  useEffect(() => {
    void load();
  }, []);

  const submit = async () => {
    setMsg(null);
    if (!file || !name.trim()) {
      setMsg("이름과 SVG 파일을 선택하세요.");
      return;
    }
    const tok = token();
    if (!tok) {
      setMsg("관리자로 로그인한 뒤 다시 시도하세요.");
      return;
    }
    setBusy(true);
    try {
      const svg = await file.text();
      const res = await fetch(apiUrl("/api/admin/irregular-templates"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tok}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          cutKind,
          svg,
          assemblyCountHint: assemblyHint === "auto" ? undefined : Number(assemblyHint),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { message?: string; template?: TemplateRow };
      if (!res.ok) {
        setMsg(j.message || `HTTP ${res.status}`);
        return;
      }
      setMsg(`등록 완료 (조각 ${j.template?.piece_count ?? "?"}개, 어셈블리 ${j.template?.assembly_count ?? "?"}개)`);
      setName("");
      setFile(null);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl text-white">
      <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
        <Layers className="w-5 h-5 text-indigo-400" />
        비정형 칼선 (SVG)
      </h2>
      <p className="text-sm text-slate-400 mb-4">
        일러스트레이터에서보낸 SVG를 그대로 올리면 서버가 조각·이웃·어셈블리(복수 퍼즐)를 자동 분석합니다. DB 마이그레이션{" "}
        <code className="text-indigo-300">012_irregular_puzzle.sql</code> 적용이 필요합니다.
      </p>

      <div className="space-y-3 mb-6">
        <input
          type="text"
          placeholder="템플릿 이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
        />
        <select
          value={cutKind}
          onChange={(e) => setCutKind(e.target.value as "generic" | "image_specific")}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
        >
          <option value="generic">범용 칼선</option>
          <option value="image_specific">이미지 특화 칼선</option>
        </select>
        <select
          value={assemblyHint}
          onChange={(e) => setAssemblyHint(e.target.value as "auto" | "1" | "2")}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
        >
          <option value="auto">어셈블리: 자동 (8조각↑ → 최대 2묶음)</option>
          <option value="1">어셈블리: 1묶음 (한 퍼즐만)</option>
          <option value="2">어셈블리: 2묶음 (한 이미지에 퍼즐 2개)</option>
        </select>
        <input
          type="file"
          accept=".svg,image/svg+xml"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full text-sm text-slate-300"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-3 rounded-xl font-medium"
        >
          <Upload className="w-4 h-4" />
          {busy ? "처리 중…" : "업로드 및 파싱"}
        </button>
        {msg && <p className="text-sm text-amber-200">{msg}</p>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="py-2 px-2">이름</th>
              <th className="py-2 px-2">종류</th>
              <th className="py-2 px-2">조각</th>
              <th className="py-2 px-2">어셈블리</th>
              <th className="py-2 px-2">SVG</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className="border-b border-slate-800/60">
                <td className="py-2 px-2">{t.name}</td>
                <td className="py-2 px-2">{t.cut_kind}</td>
                <td className="py-2 px-2">{t.piece_count}</td>
                <td className="py-2 px-2">{t.assembly_count}</td>
                <td className="py-2 px-2">
                  <a href={t.svg_url} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                    보기
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {templates.length === 0 && <p className="text-slate-500 text-sm mt-2">등록된 템플릿이 없습니다.</p>}
      </div>
    </div>
  );
}
