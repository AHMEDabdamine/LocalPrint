import React, { useState, useRef, useEffect, useCallback } from "react";
import { PDFDocument } from "pdf-lib";
import LoadJobModal from "../components/LoadJobModal";
import { useLanguage } from "../lib/useLanguage";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../components/ui/dialog";

const MM_TO_PT = 2.83465;
const SCALE = 0.45;
const PAPER_SIZES: { label: string; w: number; h: number }[] = [
  { label: "A4 (210x297mm)", w: 595.28, h: 841.89 },
  { label: "A3 (297x420mm)", w: 841.89, h: 1190.55 },
];

const CARD_SIZES: { label: string; w: number; h: number }[] = [
  { label: "CR80 (ID-1) 85.6x54mm", w: 85.6, h: 54 },
  { label: "CR79 85.5x54mm", w: 85.5, h: 54 },
  { label: "CR90 92x60mm", w: 92, h: 60 },
  { label: "CR100 98.5x67mm", w: 98.5, h: 67 },
  { label: "Business Card 90x50mm", w: 90, h: 50 },
  { label: "ID-2 (A4 folded) 105x74mm", w: 105, h: 74 },
  { label: "ID-3 (Passport) 125x88mm", w: 125, h: 88 },
];

function renderPdfPageToDataUrl(buf: ArrayBuffer): Promise<string> {
  return PDFDocument.load(buf).then(async (pdf) => {
    const pages = pdf.getPages();
    if (!pages.length) throw new Error("PDF has no pages");
    const first = pages[0];
    const { width, height } = first.getSize();
    const s = 200 / 72;
    const canvas = document.createElement("canvas");
    canvas.width = width * s;
    canvas.height = height * s;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");
    const blob = new Blob([buf], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    return new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to render PDF")); };
      img.src = url;
    });
  });
}

function readFileAsDataUrl(f: File | null | undefined): Promise<string> {
  if (!f) return Promise.reject(new Error("No file provided"));
  return new Promise((resolve, reject) => {
    if (f.type === "application/pdf") {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.onload = (e) => {
        const buf = e.target?.result as ArrayBuffer;
        renderPdfPageToDataUrl(buf).then(resolve).catch(reject);
      };
      reader.readAsArrayBuffer(f);
    } else if (f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(f);
    } else {
      reject(new Error("Unsupported file type"));
    }
  });
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function embedImageInPdf(pdfDoc: PDFDocument, dataUrl: string) {
  const isJpeg = dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg");
  const bytes = dataUrlToBytes(dataUrl);
  return isJpeg ? pdfDoc.embedJpg(bytes) : pdfDoc.embedPng(bytes);
}

function containFit(imgW: number, imgH: number, boxW: number, boxH: number) {
  const scale = Math.min(boxW / imgW, boxH / imgH);
  return { w: imgW * scale, h: imgH * scale };
}

function computeGrid(pw: number, ph: number, margin: number, cols: number, rows: number, hGap: number, vGap: number) {
  const m = margin * MM_TO_PT;
  const hg = hGap * MM_TO_PT;
  const vg = vGap * MM_TO_PT;
  const cw = (pw - 2 * m - (cols - 1) * hg) / cols;
  const ch = (ph - 2 * m - (rows - 1) * vg) / rows;
  const cards: { x: number; y: number; w: number; h: number }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cards.push({
        x: m + col * (cw + hg),
        y: ph - m - (row + 1) * ch - row * vg,
        w: cw,
        h: ch,
      });
    }
  }
  return cards;
}

const CardIDTool: React.FC = () => {
  const { t } = useLanguage();
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [frontDataUrl, setFrontDataUrl] = useState<string | null>(null);
  const [backDataUrl, setBackDataUrl] = useState<string | null>(null);
  const [showJobLoader, setShowJobLoader] = useState(false);
  const [loadTarget, setLoadTarget] = useState<"front" | "back">("front");
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [showJobForm, setShowJobForm] = useState(false);
  const [jobName, setJobName] = useState("");
  const [jobPhone, setJobPhone] = useState("");
  const [jobNotes, setJobNotes] = useState("");
  const [lastPdfBlob, setLastPdfBlob] = useState<Blob | null>(null);
  const [multiCard, setMultiCard] = useState(false);
  const [cols, setCols] = useState(2);
  const [rows, setRows] = useState(2);
  const [hGap, setHGap] = useState(5);
  const [vGap, setVGap] = useState(5);
  const [margin, setMargin] = useState(10);
  const [sizeIdx, setSizeIdx] = useState(0);
  const [paperIdx, setPaperIdx] = useState(0);
  const PP_W = PAPER_SIZES[paperIdx].w;
  const PP_H = PAPER_SIZES[paperIdx].h;
  const PAD = 10 * MM_TO_PT;
  const cardW = CARD_SIZES[sizeIdx].w * MM_TO_PT;
  const cardH = CARD_SIZES[sizeIdx].h * MM_TO_PT;
  const frontCanvasRef = useRef<HTMLCanvasElement>(null);
  const backCanvasRef = useRef<HTMLCanvasElement>(null);

  const handleFrontFile = useCallback(async (f: File) => {
    setExportError("");
    setFrontFile(f);
    try {
      setFrontDataUrl(await readFileAsDataUrl(f));
    } catch (e: any) {
      setExportError("Front image: " + (e.message || "failed to load"));
    }
  }, []);

  const handleBackFile = useCallback(async (f: File) => {
    setExportError("");
    setBackFile(f);
    try {
      setBackDataUrl(await readFileAsDataUrl(f));
    } catch (e: any) {
      setExportError("Back image: " + (e.message || "failed to load"));
    }
  }, []);

  const drawPreview = (canvas: HTMLCanvasElement | null, dataUrl: string | null, isFront: boolean) => {
    if (!canvas || !dataUrl) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pw = PP_W * SCALE;
    const ph = PP_H * SCALE;
    canvas.width = pw;
    canvas.height = ph;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pw, ph);
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, pw, ph);
    const slots = multiCard
      ? computeGrid(PP_W, PP_H, margin, cols, rows, hGap, vGap)
      : [{
          x: isFront ? PAD : PP_W - PAD - cardW,
          y: PP_H - PAD - cardH,
          w: cardW,
          h: cardH,
        }];
    const img = new Image();
    img.onload = () => {
      for (const slot of slots) {
        const cw = slot.w * SCALE;
        const ch = slot.h * SCALE;
        const cx = slot.x * SCALE;
        const cy = (PP_H - slot.y - slot.h) * SCALE;
        ctx.fillStyle = "#e5e7eb";
        ctx.fillRect(cx, cy, cw, ch);
        ctx.strokeStyle = "#9ca3af";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(cx, cy, cw, ch);
        const iw = img.naturalWidth || cw;
        const ih = img.naturalHeight || ch;
        const fitted = containFit(iw, ih, cw, ch);
        const ix = cx + (cw - fitted.w) / 2;
        const iy = cy + (ch - fitted.h) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx, cy, cw, ch);
        ctx.clip();
        ctx.drawImage(img, ix, iy, fitted.w, fitted.h);
        ctx.restore();
      }
    };
    img.src = dataUrl;
  };

  useEffect(() => { drawPreview(frontCanvasRef.current, frontDataUrl, true); }, [frontDataUrl, multiCard, cols, rows, hGap, vGap, margin, sizeIdx, paperIdx]);
  useEffect(() => { drawPreview(backCanvasRef.current, backDataUrl, false); }, [backDataUrl, multiCard, cols, rows, hGap, vGap, margin, sizeIdx, paperIdx]);

  const generatePdf = async (): Promise<Blob | null> => {
    if (!frontDataUrl && !backDataUrl) return null;
    setExportError("");
    setExporting(true);
    try {
      const pdfDoc = await PDFDocument.create();
      const slots = multiCard
        ? computeGrid(PP_W, PP_H, margin, cols, rows, hGap, vGap)
        : [{
            x: PAD,
            y: PP_H - PAD - cardH,
            w: cardW,
            h: cardH,
          }];

      const addPage = async (dataUrl: string, isFront: boolean) => {
        const page = pdfDoc.addPage([PP_W, PP_H]);
        const img = await embedImageInPdf(pdfDoc, dataUrl);
        for (const slot of slots) {
          const sx = isFront ? slot.x : PP_W - slot.x - slot.w;
          const fitted = containFit(img.width, img.height, slot.w, slot.h);
          page.drawImage(img, {
            x: sx + (slot.w - fitted.w) / 2,
            y: slot.y + (slot.h - fitted.h) / 2,
            width: fitted.w,
            height: fitted.h,
          });
        }
      };

      if (frontDataUrl) await addPage(frontDataUrl, true);
      if (backDataUrl) await addPage(backDataUrl, false);

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      setLastPdfBlob(blob);
      return blob;
    } catch (e: any) {
      setExportError(e?.message || "Export failed");
      return null;
    } finally {
      setExporting(false);
    }
  };

  const handleDownload = async () => {
    const blob = await generatePdf();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "id-card-duplex.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrint = async () => {
    const blob = await generatePdf();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const handleAddToJobs = async () => {
    const blob = await generatePdf();
    if (!blob) return;
    setShowJobForm(true);
  };

  const submitJob = async () => {
    if (!lastPdfBlob || !jobName.trim()) return;
    setExportError("");
    setExporting(true);
    try {
      const file = new File([lastPdfBlob], "id-cards.pdf", { type: "application/pdf" });
      const metadata = JSON.stringify({
        customer: jobName.trim(),
        phone: jobPhone.trim(),
        notes: jobNotes.trim(),
        copies: 1,
        duplex: true,
      });
      const body = new FormData();
      body.append("file", file);
      body.append("metadata", metadata);
      const res = await fetch("/api/upload", { method: "POST", body });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      setShowJobForm(false);
      setJobName("");
      setJobPhone("");
      setJobNotes("");
      setLastPdfBlob(null);
    } catch (e: any) {
      setExportError(e?.message || "Failed to add job");
    } finally {
      setExporting(false);
    }
  };

  const jobLoaderSelect = (job: any, file: File | null) => {
    if (!file) return;
    setExportError("");
    if (loadTarget === "front") handleFrontFile(file);
    else handleBackFile(file);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-4">
        <Card className="shadow-none">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-semibold">{t("frontImage")}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {!frontFile ? (
              <div className="space-y-3">
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-input rounded-xl p-4 cursor-pointer hover:border-primary/50 transition">
                  <svg className="w-6 h-6 text-muted-foreground mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <span className="text-xs text-muted-foreground">{t("uploadFront")}</span>
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFrontFile(f); }} />
                </label>
                <Button variant="link" size="sm" className="w-full text-xs" onClick={() => { setLoadTarget("front"); setShowJobLoader(true); }}>
                  {t("loadFromJobs")}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex-1 truncate text-sm">{frontFile.name}</div>
                <Button variant="ghost" size="sm" className="text-destructive h-auto px-2 py-1 text-xs" onClick={() => { setFrontFile(null); setFrontDataUrl(null); }}>
                  {t("remove")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-semibold">{t("backImage")}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {!backFile ? (
              <div className="space-y-3">
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-input rounded-xl p-4 cursor-pointer hover:border-primary/50 transition">
                  <svg className="w-6 h-6 text-muted-foreground mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <span className="text-xs text-muted-foreground">{t("uploadBack")}</span>
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBackFile(f); }} />
                </label>
                <Button variant="link" size="sm" className="w-full text-xs" onClick={() => { setLoadTarget("back"); setShowJobLoader(true); }}>
                  {t("loadFromJobs")}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex-1 truncate text-sm">{backFile.name}</div>
                <Button variant="ghost" size="sm" className="text-destructive h-auto px-2 py-1 text-xs" onClick={() => { setBackFile(null); setBackDataUrl(null); }}>
                  {t("remove")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-semibold">{t("printOptions")}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="multiCard" checked={multiCard}
                onChange={(e) => setMultiCard(e.target.checked)}
                className="rounded border-input h-4 w-4 accent-primary" />
              <Label htmlFor="multiCard" className="text-sm font-medium cursor-pointer">{t("multipleCards")}</Label>
            </div>
            {multiCard ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("columns")}</Label>
                  <Input type="number" min={1} max={10} value={cols}
                    onChange={(e) => setCols(Math.max(1, +e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("rows")}</Label>
                  <Input type="number" min={1} max={10} value={rows}
                    onChange={(e) => setRows(Math.max(1, +e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("hGap")}</Label>
                  <Input type="number" min={0} max={30} value={hGap}
                    onChange={(e) => setHGap(Math.max(0, +e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("vGap")}</Label>
                  <Input type="number" min={0} max={30} value={vGap}
                    onChange={(e) => setVGap(Math.max(0, +e.target.value))} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs">{t("margin")}</Label>
                  <Input type="number" min={0} max={50} value={margin}
                    onChange={(e) => setMargin(Math.max(0, +e.target.value))} />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("cardSize")}</Label>
                  <select className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={sizeIdx} onChange={(e) => setSizeIdx(+e.target.value)}>
                    {CARD_SIZES.map((s, i) => (
                      <option key={i} value={i}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-muted-foreground">{t("page1Left")}</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">{t("paperSize")}</Label>
              <select className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={paperIdx} onChange={(e) => setPaperIdx(+e.target.value)}>
                {PAPER_SIZES.map((s, i) => (
                  <option key={i} value={i}>{s.label}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">{t("printDuplex")}</p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Button
            disabled={(!frontDataUrl && !backDataUrl) || exporting}
            onClick={handleDownload}
          >
            {exporting ? "..." : t("download")}
          </Button>
          <Button
            disabled={(!frontDataUrl && !backDataUrl) || exporting}
            variant="secondary"
            onClick={handlePrint}
          >
            {t("print")}
          </Button>
          <Button
            disabled={(!frontDataUrl && !backDataUrl) || exporting}
            variant="outline"
            onClick={handleAddToJobs}
          >
            {t("addToJobs")}
          </Button>
        </div>

        {exportError && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-xl p-3 border border-destructive/20">{exportError}</div>
        )}

        <Dialog open={showJobForm} onOpenChange={setShowJobForm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("addToJobsTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t("customerNameRequired")}</Label>
                <Input value={jobName} onChange={(e) => setJobName(e.target.value)} autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label>{t("phone")}</Label>
                <Input value={jobPhone} onChange={(e) => setJobPhone(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("studioNotes")}</Label>
                <Textarea value={jobNotes} onChange={(e) => setJobNotes(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowJobForm(false)}>{t("studioCancel")}</Button>
              <Button disabled={!jobName.trim() || exporting} onClick={submitJob}>
                {exporting ? t("uploading") : t("addJob")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="lg:col-span-2">
        <Card className="shadow-none">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-semibold">{t("preview")}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {!frontDataUrl && !backDataUrl ? (
              <div className="flex items-center justify-center h-[300px] bg-muted/30 rounded-xl text-muted-foreground text-sm">{t("noImages")}</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2 text-center">{t("page1")}</p>
                  {frontDataUrl ? (
                    <div className="flex justify-center">
                      <canvas ref={frontCanvasRef} className="shadow-lg rounded-xl border max-w-full" style={{ maxHeight: "60vh" }} />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-[200px] bg-muted/30 rounded-xl text-muted-foreground text-xs">{t("noImage")}</div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2 text-center">{t("page2")}</p>
                  {backDataUrl ? (
                    <div className="flex justify-center">
                      <canvas ref={backCanvasRef} className="shadow-lg rounded-xl border max-w-full" style={{ maxHeight: "60vh" }} />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-[200px] bg-muted/30 rounded-xl text-muted-foreground text-xs">{t("noImage")}</div>
                  )}
                </div>
              </div>
            )}
            <div className="mt-3 text-xs text-muted-foreground text-center">
              {CARD_SIZES[sizeIdx].label} &middot; {t("page1Left")}
            </div>
          </CardContent>
        </Card>
      </div>

      <LoadJobModal
        isOpen={showJobLoader}
        onClose={() => setShowJobLoader(false)}
        onSelect={jobLoaderSelect}
      />
    </div>
  );
};

export default CardIDTool;
