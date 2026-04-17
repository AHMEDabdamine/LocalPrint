import React, { useState, useRef, useEffect } from "react";
import { Language } from "../types";
import { TRANSLATIONS } from "../constants";

interface Point {
  x: number;
  y: number;
}

interface ImageEditorProps {
  imageBlob: Blob;
  lang: Language;
  onSave: (newBlob: Blob) => void;
  onCancel: () => void;
}

function computeHomography(
  src: { x: number; y: number }[],
  dst: { x: number; y: number }[],
): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: X, y: Y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]);
    b.push(u);
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]);
    b.push(v);
  }
  const h = gaussianElimination(A, b);
  return [...h, 1];
}

function applyHomography(H: number[], x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  return [
    (H[0] * x + H[1] * y + H[2]) / w,
    (H[3] * x + H[4] * y + H[5]) / w,
  ];
}

function gaussianElimination(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

function invertMatrix3x3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, k] = m;
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) return null;
  const inv = 1 / det;
  return [
    (e * k - f * h) * inv, (c * h - b * k) * inv, (b * f - c * e) * inv,
    (f * g - d * k) * inv, (a * k - c * g) * inv, (c * d - a * f) * inv,
    (d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv,
  ];
}

function bilinearSample(
  src: ImageData,
  w: number,
  h: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = x0 + 1, y1 = y0 + 1;
  const fx = x - x0, fy = y - y0;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v));
  const idx = (px: number, py: number) => (clamp(py, h) * w + clamp(px, w)) * 4;
  const sample = (px: number, py: number): [number, number, number, number] => {
    const i = idx(px, py);
    return [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]];
  };
  const tl = sample(x0, y0), tr = sample(x1, y0);
  const bl = sample(x0, y1), br = sample(x1, y1);
  return [0, 1, 2, 3].map((c) =>
    Math.round(
      tl[c] * (1 - fx) * (1 - fy) +
      tr[c] * fx * (1 - fy) +
      bl[c] * (1 - fx) * fy +
      br[c] * fx * fy,
    ),
  ) as [number, number, number, number];
}

const ImageEditor: React.FC<ImageEditorProps> = ({
  imageBlob,
  lang,
  onSave,
  onCancel,
}) => {
  const t = (key: string) => TRANSLATIONS[key][lang];
  const isRtl = lang === "ar";

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<"crop" | "perspective">("crop");
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Base dimensions (fitting the screen initially)
  const [baseSize, setBaseSize] = useState({ width: 0, height: 0 });

  // Crop points (stored in baseSize coordinates)
  const [cropRect, setCropRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  }>({ x: 50, y: 50, w: 200, h: 200 });
  // Perspective points (stored in baseSize coordinates)
  const [points, setPoints] = useState<Point[]>([
    { x: 50, y: 50 },
    { x: 250, y: 50 },
    { x: 250, y: 250 },
    { x: 50, y: 250 },
  ]);

  const [dragIdx, setDragIdx] = useState<number | "rect" | null>(null);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [globalMousePos, setGlobalMousePos] = useState<Point>({ x: 0, y: 0 });

  useEffect(() => {
    const img = new Image();
    const url = URL.createObjectURL(imageBlob);
    img.src = url;
    img.onload = () => {
      setImage(img);
      // Calculate a reasonable base size that fits the screen
      const maxWidth = window.innerWidth * 0.8;
      const maxHeight = window.innerHeight * 0.6;

      let w = img.width;
      let h = img.height;

      if (w > maxWidth) {
        h = (maxWidth / w) * h;
        w = maxWidth;
      }
      if (h > maxHeight) {
        w = (maxHeight / h) * w;
        h = maxHeight;
      }

      setBaseSize({ width: w, height: h });
      setPoints([
        { x: w * 0.1, y: h * 0.1 },
        { x: w * 0.9, y: h * 0.1 },
        { x: w * 0.9, y: h * 0.9 },
        { x: w * 0.1, y: h * 0.9 },
      ]);
      setCropRect({ x: w * 0.2, y: h * 0.2, w: w * 0.6, h: h * 0.6 });
    };
    return () => URL.revokeObjectURL(url);
  }, [imageBlob]);

  // Global mouse tracking for smooth corner control
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDragging && dragIdx !== null) {
        setGlobalMousePos({ x: e.clientX, y: e.clientY });
      }
    };

    const handleGlobalMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        setDragIdx(null);
      }
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleGlobalMouseMove);
      document.addEventListener("mouseup", handleGlobalMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleGlobalMouseMove);
        document.removeEventListener("mouseup", handleGlobalMouseUp);
      };
    }
  }, [isDragging, dragIdx]);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas || !image || baseSize.width === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Apply zoom to canvas resolution
    canvas.width = baseSize.width * zoom;
    canvas.height = baseSize.height * zoom;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw image scaled by zoom
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";

    if (mode === "crop") {
      // Outer shadow
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.rect(
        cropRect.x * zoom,
        cropRect.y * zoom,
        cropRect.w * zoom,
        cropRect.h * zoom,
      );
      ctx.fill("evenodd");

      // Border
      ctx.strokeStyle = "#6366f1";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        cropRect.x * zoom,
        cropRect.y * zoom,
        cropRect.w * zoom,
        cropRect.h * zoom,
      );

      // Handles
      ctx.fillStyle = "#6366f1";
      const handles = [
        { x: cropRect.x, y: cropRect.y },
        { x: cropRect.x + cropRect.w, y: cropRect.y },
        { x: cropRect.x + cropRect.w, y: cropRect.y + cropRect.h },
        { x: cropRect.x, y: cropRect.y + cropRect.h },
      ];
      handles.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x * zoom, p.y * zoom, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    } else {
      // Perspective logic
      ctx.beginPath();
      ctx.moveTo(points[0].x * zoom, points[0].y * zoom);
      for (let i = 1; i < 4; i++)
        ctx.lineTo(points[i].x * zoom, points[i].y * zoom);
      ctx.closePath();

      ctx.save();
      ctx.clip();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.moveTo(points[0].x * zoom, points[0].y * zoom);
      for (let i = 1; i < 4; i++)
        ctx.lineTo(points[i].x * zoom, points[i].y * zoom);
      ctx.closePath();
      ctx.fill("evenodd");

      ctx.strokeStyle = "#6366f1";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(points[0].x * zoom, points[0].y * zoom);
      for (let i = 1; i < 4; i++)
        ctx.lineTo(points[i].x * zoom, points[i].y * zoom);
      ctx.closePath();
      ctx.stroke();

      points.forEach((p) => {
        ctx.fillStyle = "#6366f1";
        ctx.beginPath();
        ctx.arc(p.x * zoom, p.y * zoom, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }
  };

  useEffect(() => {
    draw();
  }, [image, mode, points, cropRect, zoom, baseSize]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    // Convert click to "base coordinates" by dividing by zoom
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    const handleRadius = 20 / zoom; // Increased hit area for better usability

    if (mode === "perspective") {
      const idx = points.findIndex(
        (p) => Math.hypot(p.x - x, p.y - y) < handleRadius,
      );
      if (idx !== -1) {
        setDragIdx(idx);
        setIsDragging(true);
        setGlobalMousePos({ x: e.clientX, y: e.clientY });
      }
    } else {
      const handles = [
        { x: cropRect.x, y: cropRect.y },
        { x: cropRect.x + cropRect.w, y: cropRect.y },
        { x: cropRect.x + cropRect.w, y: cropRect.y + cropRect.h },
        { x: cropRect.x, y: cropRect.y + cropRect.h },
      ];
      const hIdx = handles.findIndex(
        (p) => Math.hypot(p.x - x, p.y - y) < handleRadius,
      );
      if (hIdx !== -1) {
        setDragIdx(hIdx);
        setIsDragging(true);
        setGlobalMousePos({ x: e.clientX, y: e.clientY });
      } else if (
        x > cropRect.x &&
        x < cropRect.x + cropRect.w &&
        y > cropRect.y &&
        y < cropRect.y + cropRect.h
      ) {
        setDragIdx("rect");
        setIsDragging(true);
        setOffset({ x: x - cropRect.x, y: y - cropRect.y });
        setGlobalMousePos({ x: e.clientX, y: e.clientY });
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || dragIdx === null) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    // Use global mouse position for smooth tracking
    const x = (globalMousePos.x - rect.left) / zoom;
    const y = (globalMousePos.y - rect.top) / zoom;

    // Allow movement beyond canvas bounds for better control
    const clampedX = Math.max(
      -baseSize.width * 0.5,
      Math.min(baseSize.width * 1.5, x),
    );
    const clampedY = Math.max(
      -baseSize.height * 0.5,
      Math.min(baseSize.height * 1.5, y),
    );

    if (mode === "perspective") {
      const newPoints = [...points];
      newPoints[dragIdx as number] = { x: clampedX, y: clampedY };
      setPoints(newPoints);
    } else {
      if (dragIdx === "rect") {
        const nx = Math.max(
          0,
          Math.min(baseSize.width - cropRect.w, clampedX - offset.x),
        );
        const ny = Math.max(
          0,
          Math.min(baseSize.height - cropRect.h, clampedY - offset.y),
        );
        setCropRect((prev) => ({ ...prev, x: nx, y: ny }));
      } else {
        const idx = dragIdx as number;
        setCropRect((prev) => {
          let { x: nx, y: ny, w: nw, h: nh } = prev;
          if (idx === 0) {
            nw += nx - clampedX;
            nh += ny - clampedY;
            nx = clampedX;
            ny = clampedY;
          } else if (idx === 1) {
            nw = clampedX - nx;
            nh += ny - clampedY;
            ny = clampedY;
          } else if (idx === 2) {
            nw = clampedX - nx;
            nh = clampedY - ny;
          } else if (idx === 3) {
            nw += nx - clampedX;
            nh = clampedY - ny;
            nx = clampedX;
          }
          return { x: nx, y: ny, w: Math.max(20, nw), h: Math.max(20, nh) };
        });
      }
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom((prev) => Math.max(0.5, Math.min(5, prev + delta)));
    }
  };

  const handleApply = async () => {
    if (!image || !canvasRef.current) return;
    setIsProcessing(true);

    const scale = image.width / baseSize.width;

    if (mode === "crop") {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = cropRect.w * scale;
      canvas.height = cropRect.h * scale;
      ctx.drawImage(
        image,
        cropRect.x * scale, cropRect.y * scale,
        cropRect.w * scale, cropRect.h * scale,
        0, 0, canvas.width, canvas.height,
      );
      canvas.toBlob((blob) => {
        setIsProcessing(false);
        if (blob) { setPendingBlob(blob); setShowConfirm(true); }
      }, imageBlob.type);

    } else {
      const src = points.map((p) => ({ x: p.x * scale, y: p.y * scale }));

      const outW = Math.round(Math.max(
        Math.hypot(src[1].x - src[0].x, src[1].y - src[0].y),
        Math.hypot(src[2].x - src[3].x, src[2].y - src[3].y),
      ));
      const outH = Math.round(Math.max(
        Math.hypot(src[3].x - src[0].x, src[3].y - src[0].y),
        Math.hypot(src[2].x - src[1].x, src[2].y - src[1].y),
      ));

      const dst = [
        { x: 0,    y: 0    },
        { x: outW, y: 0    },
        { x: outW, y: outH },
        { x: 0,    y: outH },
      ];

      const H = computeHomography(src, dst);
      const H_inv = invertMatrix3x3(H);
      if (!H_inv) { setIsProcessing(false); return; }

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const srcCanvas = document.createElement("canvas");
      srcCanvas.width = image.width;
      srcCanvas.height = image.height;
      const srcCtx = srcCanvas.getContext("2d")!;
      srcCtx.drawImage(image, 0, 0);
      const srcData = srcCtx.getImageData(0, 0, image.width, image.height);
      const outData = ctx.createImageData(outW, outH);

      for (let dy = 0; dy < outH; dy++) {
        for (let dx = 0; dx < outW; dx++) {
          const [sx, sy] = applyHomography(H_inv, dx + 0.5, dy + 0.5);
          const color = bilinearSample(srcData, image.width, image.height, sx, sy);
          const i = (dy * outW + dx) * 4;
          outData.data[i]     = color[0];
          outData.data[i + 1] = color[1];
          outData.data[i + 2] = color[2];
          outData.data[i + 3] = color[3];
        }
      }

      ctx.putImageData(outData, 0, 0);
      canvas.toBlob((blob) => {
        setIsProcessing(false);
        if (blob) { setPendingBlob(blob); setShowConfirm(true); }
      }, imageBlob.type);
    }
  };

  const confirmSave = () => {
    if (pendingBlob) {
      onSave(pendingBlob);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center p-0 md:p-4">
      <div className="bg-white rounded-none md:rounded-2xl w-full max-w-6xl overflow-hidden flex flex-col max-h-screen md:max-h-[95vh] shadow-2xl relative">
        {/* Confirmation Overlay */}
        {showConfirm && (
          <div className="absolute inset-0 z-[110] bg-black/50 flex items-center justify-center backdrop-blur-sm p-4 text-center">
            <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-sm w-full">
              <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5 13l4 4L19 7"
                  ></path>
                </svg>
              </div>
              <h4 className="text-xl font-bold mb-2">
                {isRtl ? "تأكيد الحفظ؟" : "Confirm Save?"}
              </h4>
              <p className="text-gray-600 mb-6 text-sm">
                {isRtl
                  ? "سيتم استبدال الملف الأصلي بهذا التعديل بشكل دائم."
                  : "The original file will be permanently replaced with this edit."}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 px-4 py-2 text-gray-600 font-bold hover:bg-gray-100 rounded-xl transition"
                >
                  {t("cancel")}
                </button>
                <button
                  onClick={confirmSave}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition shadow-lg"
                >
                  {t("save")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header Toolbar */}
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4 bg-gray-50/50">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-lg hidden sm:block">{t("edit")}</h3>
            <div className="flex bg-white rounded-lg p-1 shadow-sm border border-gray-200">
              <button
                onClick={() => setMode("crop")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${
                  mode === "crop"
                    ? "bg-indigo-600 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {t("normalCrop")}
              </button>
              <button
                onClick={() => setMode("perspective")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${
                  mode === "perspective"
                    ? "bg-indigo-600 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {t("perspectiveCut")}
              </button>
            </div>
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center gap-2 bg-white rounded-lg p-1 shadow-sm border border-gray-200">
            <button
              onClick={() => setZoom((prev) => Math.max(0.5, prev - 0.25))}
              className="p-1.5 hover:bg-gray-100 rounded-md text-gray-600"
              title="Zoom Out"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M20 12H4"
                ></path>
              </svg>
            </button>
            <span className="text-xs font-bold text-gray-500 min-w-[3.5rem] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((prev) => Math.min(5, prev + 0.25))}
              className="p-1.5 hover:bg-gray-100 rounded-md text-gray-600"
              title="Zoom In"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 4v16m8-8H4"
                ></path>
              </svg>
            </button>
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <button
              onClick={() => setZoom(1)}
              className="px-2 py-1 hover:bg-gray-100 rounded-md text-[10px] font-bold text-indigo-600 uppercase"
            >
              Reset
            </button>
          </div>

          <div className="hidden sm:block text-[10px] text-gray-400 font-medium">
            {isRtl
              ? "استخدم عجلة الفأرة مع Ctrl للتقريب"
              : "Use Mouse Wheel + Ctrl to Zoom"}
          </div>
        </div>

        {/* Main Canvas Area */}
        <div
          ref={containerRef}
          onWheel={handleWheel}
          className="flex-1 overflow-auto bg-gray-900/50 flex items-center justify-center p-12 min-h-[40vh]"
        >
          <div className="relative shadow-2xl bg-white/5 p-2">
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={() => {
                if (isDragging) {
                  setIsDragging(false);
                  setDragIdx(null);
                }
              }}
              onMouseLeave={() => {
                if (isDragging) {
                  setIsDragging(false);
                  setDragIdx(null);
                }
              }}
              className="cursor-crosshair bg-white"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-gray-100 flex justify-end gap-3 bg-gray-50/50">
          <button
            onClick={onCancel}
            className="px-6 py-2.5 text-gray-600 font-bold hover:bg-gray-200/50 rounded-xl transition text-sm"
          >
            {t("cancel")}
          </button>
          <button
            onClick={handleApply}
            disabled={isProcessing}
            className="px-8 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition shadow-lg shadow-indigo-200 text-sm flex items-center gap-2"
          >
            {isProcessing && (
              <svg
                className="animate-spin h-4 w-4 text-white"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            )}
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImageEditor;
