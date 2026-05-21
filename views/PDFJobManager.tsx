import React, { useState, useRef, useEffect, useCallback } from "react";
import { PDFDocument, PageSizes, degrees } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import LoadJobModal from "../components/LoadJobModal";
import { useLanguage } from "../lib/useLanguage";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../components/ui/dialog";
import { cn } from "../lib/utils";
import { storageService } from "../services/storageService";
import type { PrintJob } from "../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface PageEntry {
  id: string;
  index: number;
  rotation: number;
}

const PAPER_SIZES = [
  { label: "A4 (210×297mm)", value: "A4", size: PageSizes.A4 },
  { label: "A3 (297×420mm)", value: "A3", size: PageSizes.A3 },
];

const THUMB_W = 160;
const THUMB_H = 220;

function normRotation(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

const PDFJobManager: React.FC = () => {
  const { t, lang } = useLanguage();
  const isRtl = lang === "ar";

  const [file, setFile] = useState<File | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [thumbVersion, setThumbVersion] = useState(0);
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [sourceJob, setSourceJob] = useState<PrintJob | null>(null);
  const [saving, setSaving] = useState(false);
  const [copies, setCopies] = useState(1);
  const [colorMode, setColorMode] = useState<"color" | "bw">("color");
  const [paperSize, setPaperSize] = useState("A4");
  const [duplex, setDuplex] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showJobLoader, setShowJobLoader] = useState(false);
  const [showNewJobDialog, setShowNewJobDialog] = useState(false);
  const [addJobName, setAddJobName] = useState("");
  const [addJobPhone, setAddJobPhone] = useState("");
  const [addJobNotes, setAddJobNotes] = useState("");
  const [addJobUploading, setAddJobUploading] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [rangeFrom, setRangeFrom] = useState(1);
  const [rangeTo, setRangeTo] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  const renderThumbnails = useCallback(async (buf: ArrayBuffer, pageEntries: PageEntry[]) => {
    const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
    const results: Record<string, string> = {};
    for (const entry of pageEntries) {
      const page = await pdf.getPage(entry.index + 1);
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(THUMB_W / viewport.width, THUMB_H / viewport.height, 0.4);
      const scaled = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = scaled.width;
      canvas.height = scaled.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport: scaled, rotation: entry.rotation }).promise;
      results[entry.id] = canvas.toDataURL("image/png");
    }
    setThumbnails((prev) => ({ ...prev, ...results }));
  }, []);

  const loadPdf = async (f: File, buf: ArrayBuffer) => {
    setFile(f);
    const pdf = await PDFDocument.load(buf);
    const count = pdf.getPageCount();
    const entries: PageEntry[] = Array.from({ length: count }, (_, i) => ({
      id: crypto.randomUUID(),
      index: i,
      rotation: 0,
    }));
    setPages(entries);
    setPdfBytes(buf);
    setSelectedPages(new Set());
    setThumbnails({});
    setThumbVersion(0);
    renderThumbnails(buf, entries);
  };

  const handleFile = async (f: File | null | undefined) => {
    if (!f || f.type !== "application/pdf") return;
    setSourceJob(null);
    const buf = await f.arrayBuffer();
    await loadPdf(f, buf);
  };

  const handleLoadFromJob = async (job: PrintJob, f: File) => {
    if (!f || f.type !== "application/pdf") return;
    setSourceJob(job);
    const buf = await f.arrayBuffer();
    await loadPdf(f, buf);
  };

  useEffect(() => {
    if (pdfBytes && pages.length > 0) {
      renderThumbnails(pdfBytes, pages);
    }
  }, [pdfBytes, pages, thumbVersion, renderThumbnails]);

  useEffect(() => {
    if (pages.length > 0) {
      setRangeFrom(1);
      setRangeTo(pages.length);
    }
  }, [pages.length]);

  const toggleSelect = (id: string) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rotatePages = (ids: string[], degrees: number) => {
    setPages((prev) =>
      prev.map((p) =>
        ids.includes(p.id) ? { ...p, rotation: normRotation(p.rotation + degrees) } : p,
      ),
    );
    setThumbVersion((v) => v + 1);
  };

  const deletePages = (ids: string[]) => {
    const idSet = new Set(ids);
    setPages((prev) => prev.filter((p) => !idSet.has(p.id)));
    setSelectedPages((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setThumbVersion((v) => v + 1);
  };

  const movePage = (fromId: string, toId: string) => {
    setPages((prev) => {
      const copy = [...prev];
      const fromIdx = copy.findIndex((p) => p.id === fromId);
      const toIdx = copy.findIndex((p) => p.id === toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy;
    });
    setThumbVersion((v) => v + 1);
  };

  const buildPdfFromPages = async (): Promise<Uint8Array> => {
    if (!pdfBytes) throw new Error("No PDF loaded");
    const sourcePdf = await PDFDocument.load(pdfBytes.slice(0));
    const newDoc = await PDFDocument.create();
    for (const entry of pages) {
      const [copiedPage] = await newDoc.copyPages(sourcePdf, [entry.index]);
      const rot = normRotation(entry.rotation);
      if (rot !== 0) {
        copiedPage.setRotation(degrees(rot));
      }
      newDoc.addPage(copiedPage);
    }
    return newDoc.save();
  };

  const getExportPageCount = (): number => {
    if (duplex) return Math.ceil((pages.length * copies) / 2) * 2;
    return pages.length * copies;
  };

  const exportPDF = async () => {
    if (!pdfBytes) return;
    setExporting(true);
    try {
      const sourcePdf = await PDFDocument.load(pdfBytes.slice(0));
      const newDoc = await PDFDocument.create();
      const sizeKey = paperSize as keyof typeof PageSizes;
      const targetSize = PageSizes[sizeKey] || PageSizes.A4;

      for (let c = 0; c < copies; c++) {
        for (const entry of pages) {
          const [copiedPage] = await newDoc.copyPages(sourcePdf, [entry.index]);
          const rot = normRotation(entry.rotation);
          if (rot !== 0) {
            copiedPage.setRotation(degrees(rot));
          }
          const [pw, ph] = targetSize;
          const page = newDoc.addPage(targetSize);
          const scale = Math.min(pw / copiedPage.getWidth(), ph / copiedPage.getHeight());
          const sw = copiedPage.getWidth() * scale;
          const sh = copiedPage.getHeight() * scale;
          page.drawPage(copiedPage, {
            x: (pw - sw) / 2,
            y: (ph - sh) / 2,
            width: sw,
            height: sh,
            xScale: scale,
            yScale: scale,
          });
        }
      }
      const bytes = await newDoc.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${file?.name.replace(".pdf", "") || "print"}-ready.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const exportAsImages = async () => {
    if (!pdfBytes || pages.length === 0) return;
    setExporting(true);
    try {
      const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
      const scale = 2;
      for (let i = 0; i < pages.length; i++) {
        const entry = pages[i];
        const page = await pdf.getPage(entry.index + 1);
        const viewport = page.getViewport({ scale, rotation: entry.rotation });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, "image/png"),
        );
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${file?.name.replace(".pdf", "") || "page"}_page_${i + 1}.png`;
          a.click();
          URL.revokeObjectURL(url);
        }
      }
    } finally {
      setExporting(false);
    }
  };

  const printDirectly = async () => {
    if (!pdfBytes || pages.length === 0) return;
    const output = await buildPdfFromPages();
    const blob = new Blob([output], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const addToNewJob = async () => {
    if (!file || !pdfBytes) return;
    setAddJobUploading(true);
    try {
      const output = await buildPdfFromPages();
      const blob = new Blob([output], { type: "application/pdf" });
      const outFile = new File([blob], file.name, { type: "application/pdf" });
      const job: PrintJob = {
        id: crypto.randomUUID(),
        customerName: addJobName,
        phoneNumber: addJobPhone,
        notes: addJobNotes,
        fileName: file.name,
        fileType: "application/pdf",
        fileSize: blob.size,
        uploadDate: new Date().toISOString(),
        status: "PENDING" as any,
        pageCount: pages.length,
        printPreferences: {
          colorMode: colorMode === "bw" ? "blackWhite" : "color",
          copies,
          paperType: "normal",
        },
      };
      await storageService.saveJob(job, outFile);
      setShowNewJobDialog(false);
      setAddJobName("");
      setAddJobPhone("");
      setAddJobNotes("");
    } finally {
      setAddJobUploading(false);
    }
  };

  const saveToSourceJob = async () => {
    if (!sourceJob || !file || !pdfBytes) return;
    setSaving(true);
    try {
      const output = await buildPdfFromPages();
      const blob = new Blob([output], { type: "application/pdf" });
      const outFile = new File([blob], file.name, { type: "application/pdf" });
      await storageService.updateJobFile(sourceJob.id, outFile);
      await storageService.updateJobPreferences(sourceJob.id, {
        colorMode: colorMode === "bw" ? "blackWhite" : "color",
        copies,
        paperType: "normal",
      });
    } finally {
      setSaving(false);
    }
  };

  const selectAll = () => {
    if (selectedPages.size === pages.length) {
      setSelectedPages(new Set());
    } else {
      setSelectedPages(new Set(pages.map((p) => p.id)));
    }
  };

  const sidebar = (
    <div className="space-y-4">
      <Card className="shadow-none">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-semibold">{t("sourcePDF")}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {!file ? (
            <div className="space-y-3">
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-input rounded-xl p-6 cursor-pointer hover:border-primary/50 transition">
                <svg className="w-8 h-8 text-muted-foreground mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span className="text-sm text-muted-foreground">{t("uploadPDF")}</span>
                <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </label>
              <Button variant="link" size="sm" className="w-full" onClick={() => setShowJobLoader(true)}>
                {t("loadFromPrintJobs")}
              </Button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3">
                <div className="flex-1 truncate text-sm font-medium">{file.name}</div>
                <Button variant="ghost" size="sm" className="text-destructive h-auto px-2 py-1 text-xs shrink-0"
                  onClick={() => { setFile(null); setPdfBytes(null); setPages([]); setThumbnails({}); setSelectedPages(new Set()); setSourceJob(null); }}>
                  {t("remove")}
                </Button>
              </div>
              {sourceJob && (
                <div className="mt-1.5 text-[11px] text-muted-foreground bg-muted/50 rounded-lg px-2 py-1 truncate">
                  {isRtl
                    ? `📂 من طلب: ${sourceJob.customerName || "بدون اسم"}`
                    : `📂 From job: ${sourceJob.customerName || "Unknown"}`}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {pages.length > 0 && (
        <>
          <Card className="shadow-none">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-semibold">
                {isRtl ? "أدوات" : "Tools"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-muted-foreground flex-1">
                  {isRtl
                    ? `${selectedPages.size} من ${pages.length} صفحة`
                    : `${selectedPages.size} of ${pages.length} page(s)`}
                </span>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={selectAll}>
                  {selectedPages.size === pages.length
                    ? (isRtl ? "إلغاء" : "None")
                    : (isRtl ? "الكل" : "All")}
                </Button>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <Button variant="outline" size="sm" className="h-8 text-xs flex-1"
                  disabled={selectedPages.size === 0}
                  onClick={() => rotatePages([...selectedPages], 90)}>
                  ↻ 90°
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-xs flex-1"
                  disabled={selectedPages.size === 0}
                  onClick={() => rotatePages([...selectedPages], -90)}>
                  ↺ 90°
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-xs flex-1"
                  disabled={selectedPages.size === 0}
                  onClick={() => rotatePages([...selectedPages], 180)}>
                  ↔ 180°
                </Button>
              </div>
              <Button variant="destructive" size="sm" className="w-full h-8 text-xs"
                disabled={selectedPages.size === 0}
                onClick={() => deletePages([...selectedPages])}>
                {isRtl ? `✕ حذف (${selectedPages.size})` : `✕ Delete (${selectedPages.size})`}
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-semibold">{t("splitByRange")}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              <div className="flex gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">{t("fromPage")}</Label>
                  <Input type="number" min={1} max={pages.length} value={rangeFrom}
                    onChange={(e) => setRangeFrom(Math.max(1, Math.min(+e.target.value || 1, pages.length)))} />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">{t("toPage")}</Label>
                  <Input type="number" min={1} max={pages.length} value={rangeTo}
                    onChange={(e) => setRangeTo(Math.max(1, Math.min(+e.target.value || 1, pages.length)))} />
                </div>
              </div>
              <Button variant="secondary" size="sm" className="w-full h-8 text-xs"
                disabled={rangeFrom > rangeTo || rangeFrom < 1 || rangeTo > pages.length}
                onClick={() => {
                  setPages((prev) => prev.slice(rangeFrom - 1, rangeTo));
                  setSelectedPages(new Set());
                  setThumbVersion((v) => v + 1);
                }}>
                {t("split")}
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-semibold">{t("printOptions")}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("copies")}</Label>
                <Input type="number" min={1} max={999} value={copies}
                  onChange={(e) => setCopies(Math.max(1, +e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("colorMode")}</Label>
                <Select value={colorMode} onValueChange={(v) => setColorMode(v as "color" | "bw")}>
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="color">{t("color")}</SelectItem>
                    <SelectItem value="bw">{t("bw")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("paperSize")}</Label>
                <Select value={paperSize} onValueChange={setPaperSize}>
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAPER_SIZES.map((ps) => (
                      <SelectItem key={ps.value} value={ps.value}>{ps.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="duplex" checked={duplex}
                  onChange={(e) => setDuplex(e.target.checked)}
                  className="rounded border-input h-4 w-4 accent-primary" />
                <Label htmlFor="duplex" className="text-sm font-medium cursor-pointer">{t("duplex")}</Label>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-semibold">
                {isRtl ? "إجراءات" : "Actions"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              <Button className="w-full" size="sm" onClick={printDirectly}>
                🖨️ {isRtl ? "طباعة مباشرة" : "Print Directly"}
              </Button>
              <Button className="w-full" size="sm" variant="secondary"
                onClick={exportPDF} disabled={exporting}>
                {exporting ? t("exporting") : `📄 ${isRtl ? "تصدير PDF" : "Export PDF"}`}
              </Button>
              <Button className="w-full" size="sm" variant="secondary"
                onClick={exportAsImages} disabled={exporting}>
                {exporting ? t("exporting") : `🖼️ ${isRtl ? "تصدير كصور" : "Export as Images"}`}
              </Button>
              {sourceJob ? (
                <Button className="w-full" size="sm" variant="default"
                  onClick={saveToSourceJob} disabled={saving}>
                  {saving ? t("uploading") : `💾 ${isRtl ? "حفظ في الطلب" : "Save to Job"}`}
                </Button>
              ) : (
                <Button className="w-full" size="sm" variant="outline"
                  onClick={() => setShowNewJobDialog(true)}>
                  ➕ {isRtl ? "حفظ كطلب جديد" : "Save as New Job"}
                </Button>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );

  return (
    <div className="flex gap-6">
      <div className="w-80 shrink-0 max-h-[calc(100vh-12rem)] overflow-y-auto">
        {sidebar}
      </div>

      <div className="flex-1 min-w-0">
        <Card className="shadow-none">
          <CardHeader className="p-4 pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              {isRtl ? `الصفحات (${pages.length})` : `Pages (${pages.length})`}
              {pages.length > 0 && (
                <span className="text-xs font-normal text-muted-foreground mr-2">
                  {isRtl
                    ? `— ${getExportPageCount()} إجمالي`
                    : `— ${getExportPageCount()} total`}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {pages.length === 0 ? (
              <div className="flex items-center justify-center h-[500px] bg-muted/30 rounded-xl text-muted-foreground text-sm">
                {t("uploadPDFPrompt")}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4 max-h-[calc(100vh-16rem)] overflow-y-auto p-1">
                {pages.map((entry, idx) => (
                  <div key={entry.id} className="group relative">
                    <div
                      draggable
                      onDragStart={() => setDragId(entry.id)}
                      onDragOver={(e) => { e.preventDefault(); if (dragId && dragId !== entry.id) movePage(dragId, entry.id); }}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => toggleSelect(entry.id)}
                      className={cn(
                        "relative rounded-xl border-2 overflow-hidden cursor-pointer transition-all hover:shadow-md",
                        selectedPages.has(entry.id)
                          ? "border-primary ring-2 ring-primary/30"
                          : "border-border hover:border-muted-foreground/30",
                        dragId === entry.id && "opacity-50",
                      )}
                    >
                      <div className="flex items-center justify-center bg-muted/20 p-2" style={{ minHeight: THUMB_H }}>
                        {thumbnails[entry.id] ? (
                          <img src={thumbnails[entry.id]} alt={`Page ${idx + 1}`}
                            className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
                            style={{ transform: `rotate(${entry.rotation}deg)` }} />
                        ) : (
                          <div className="flex items-center justify-center w-full h-40 text-muted-foreground">
                            <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">
                        {idx + 1}
                      </div>
                      {entry.rotation !== 0 && (
                        <div className="absolute top-1 left-1 bg-primary/80 text-white text-[10px] px-1.5 py-0.5 rounded-md">
                          {entry.rotation}°
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); rotatePages([entry.id], 90); }}
                          className="bg-white/90 hover:bg-white text-gray-700 rounded-md p-1 shadow text-xs leading-none"
                          title="Rotate 90°"
                        >↻</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deletePages([entry.id]); }}
                          className="bg-white/90 hover:bg-white text-red-600 rounded-md p-1 shadow text-xs leading-none"
                          title="Delete"
                        >✕</button>
                      </div>
                    </div>
                    <p className="text-[11px] text-center text-muted-foreground mt-1 truncate">
                      {isRtl ? `صفحة ${idx + 1}` : `Page ${idx + 1}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <LoadJobModal
        isOpen={showJobLoader}
        onClose={() => setShowJobLoader(false)}
        onSelect={(job, f) => { if (f) handleLoadFromJob(job, f); }}
      />

      <Dialog open={showNewJobDialog} onOpenChange={setShowNewJobDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isRtl ? "حفظ كطلب طباعة جديد" : "Save as New Print Job"}</DialogTitle>
            <DialogDescription>
              {isRtl ? "املأ بيانات العميل لإنشاء طلب طباعة جديد" : "Fill customer details to create a new print job"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>{isRtl ? "اسم العميل" : "Customer Name"}</Label>
              <Input value={addJobName} onChange={(e) => setAddJobName(e.target.value)} placeholder={isRtl ? "الاسم" : "Name"} />
            </div>
            <div>
              <Label>{isRtl ? "رقم الهاتف" : "Phone"}</Label>
              <Input value={addJobPhone} onChange={(e) => setAddJobPhone(e.target.value)} placeholder={isRtl ? "الهاتف" : "Phone"} />
            </div>
            <div>
              <Label>{isRtl ? "ملاحظات" : "Notes"}</Label>
              <Input value={addJobNotes} onChange={(e) => setAddJobNotes(e.target.value)} placeholder={isRtl ? "ملاحظات" : "Notes"} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowNewJobDialog(false)}>
              {isRtl ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={addToNewJob} disabled={addJobUploading || !addJobName.trim()}>
              {addJobUploading ? t("uploading") : (isRtl ? "إنشاء" : "Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PDFJobManager;
