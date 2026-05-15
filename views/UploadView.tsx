import React, { useState, useRef, useEffect } from "react";
import { Language, PrintJob, PrintStatus, ShopSettings, DiscountRule, DiscountResult } from "../types";
import { TRANSLATIONS, ALLOWED_TYPES } from "../constants";
import { storageService } from "../services/storageService";
import {
  calculatePrintPrice,
  getActualPageCount,
  formatPrice,
  calculateJobDiscount,
} from "../utils/pricingUtils";
import QRCode from "qrcode";
import { toast } from "../components/ui/use-toast";
import { Toaster } from "../components/ui/toaster";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Card, CardContent } from "../components/ui/card";

interface UploadViewProps {
  lang: Language;
  shopSettings?: ShopSettings;
}

interface FileStatus {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "success" | "error";
  id: string;
}

// Custom ID generator that works in non-secure contexts (HTTP over Local IP)
const generateSafeId = () => {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
};

const UploadView: React.FC<UploadViewProps> = ({ lang, shopSettings: propSettings }) => {
  const t = (key: string) => TRANSLATIONS[key][lang] || key;
  const isRtl = lang === "ar";
  // toast() imported from use-toast, called directly

  // Confirm dialog state for canceling jobs
  const [cancelConfirm, setCancelConfirm] = useState<{
    isOpen: boolean;
    jobId: string | null;
  }>({ isOpen: false, jobId: null });

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    notes: "",
  });
  const [printPreferences, setPrintPreferences] = useState<{
    colorMode: "color" | "blackWhite";
    copies: number;
    paperType: string;
  }>({
    colorMode: "color",
    copies: 1,
    paperType: "normal",
  });
  const [selectedFiles, setSelectedFiles] = useState<FileStatus[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [overallSuccess, setOverallSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentJobs, setRecentJobs] = useState<PrintJob[]>([]);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [showQrCode, setShowQrCode] = useState(false);

  // Preview States
  const [previewJobUrl, setPreviewJobUrl] = useState<string | null>(null);
  const [previewFileType, setPreviewFileType] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pricing & Pages States
  const [shopSettings, setShopSettings] = useState<ShopSettings | null>(propSettings || null);
  const [jobPageCounts, setJobPageCounts] = useState<{
    [jobId: string]: number;
  }>({});
  const [discountRules, setDiscountRules] = useState<DiscountRule[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Sync shopSettings when prop changes (e.g. settings loaded asynchronously from server)
  useEffect(() => {
    if (propSettings) {
      setShopSettings(propSettings);
    }
  }, [propSettings]);

  useEffect(() => {
    const fetchData = async () => {
      const [jobs, settings, rules] = await Promise.all([
        storageService.getMyRecentJobs(),
        propSettings ? Promise.resolve(propSettings) : storageService.getSettings(),
        storageService.getActiveDiscountRules(),
      ]);
      setRecentJobs(jobs);
      if (!propSettings) setShopSettings(settings);
      setDiscountRules(rules);

      // Async page counting for pricing display
      if (settings?.pricing || (settings?.paperTypes && settings.paperTypes.length > 0)) {
        const counts: { [jobId: string]: number } = {};
        for (const job of jobs) {
          if (job.pageCount && job.pageCount > 0) {
            counts[job.id] = job.pageCount;
            continue;
          }
          try {
            const url = await storageService.getFileUrl(job.id);
            if (url) {
              const response = await fetch(url);
              const blob = await response.blob();
              const file = new File([blob], job.fileName, { type: job.fileType });
              counts[job.id] = await getActualPageCount(file);
            } else {
              counts[job.id] = 1;
            }
          } catch (e) {
            counts[job.id] = 1;
          }
        }
        setJobPageCounts(counts);
      }
    };
    fetchData();
  }, [overallSuccess]);

  const handleCancelJob = (id: string) => {
    setCancelConfirm({ isOpen: true, jobId: id });
  };

  const confirmCancelJob = async () => {
    if (cancelConfirm.jobId) {
      try {
        await storageService.deleteJob(cancelConfirm.jobId);
        setRecentJobs((prev) => prev.filter((job) => job.id !== cancelConfirm.jobId));
        toast({ title: isRtl ? "تم إلغاء الطباعة بنجاح" : "Print job cancelled successfully", variant: "success" });
      } catch (err) {
        console.error("Failed to cancel job", err);
        toast({ title: isRtl ? "فشل إلغاء الطباعة" : "Failed to cancel print job", variant: "destructive" });
      }
    }
    setCancelConfirm({ isOpen: false, jobId: null });
  };

  // Helper to calculate price with discount for a file
  const getFilePriceWithDiscount = (file: File) => {
    if (!shopSettings) return null;

    const allPaperTypes = shopSettings.paperTypes && shopSettings.paperTypes.length > 0
      ? shopSettings.paperTypes
      : [
          { id: "normal", name: "Normal", nameAr: "عادي", colorPerPage: shopSettings.pricing?.colorPerPage ?? 30.0, blackWhitePerPage: shopSettings.pricing?.blackWhitePerPage ?? 15.0 },
          { id: "glossy", name: "Glossy", nameAr: "لامع", colorPerPage: shopSettings.pricing?.glossyPerPage ?? 50.0, blackWhitePerPage: shopSettings.pricing?.glossyPerPage ?? 50.0 },
          { id: "cardboard", name: "Cardboard", nameAr: "ورق مقوى", colorPerPage: shopSettings.pricing?.cardboardPerPage ?? 40.0, blackWhitePerPage: shopSettings.pricing?.cardboardPerPage ?? 40.0 },
        ];

    const paperType = allPaperTypes.find(pt => pt.id === (printPreferences.paperType || "normal"));
    const pricePerPage = paperType
      ? (printPreferences.colorMode === "blackWhite" ? paperType.blackWhitePerPage : paperType.colorPerPage)
      : (printPreferences.colorMode === "blackWhite" ? (shopSettings.pricing?.blackWhitePerPage ?? 15.0) : (shopSettings.pricing?.colorPerPage ?? 30.0));

    // Estimate page count
    const estimatedPages = file.type.includes("pdf")
      ? Math.max(1, Math.ceil(file.size / 75000))
      : file.type.includes("image")
      ? 1
      : Math.max(1, Math.ceil(file.size / 50000));

    const totalPages = estimatedPages * printPreferences.copies;
    const originalPrice = pricePerPage * totalPages;

    // Debug logging
    console.log("Calculating discount for file:", file.name, {
      totalPages,
      originalPrice,
      discountRulesCount: discountRules?.length || 0,
      discountRules: discountRules,
    });

    // Calculate discount
    const discountResult = calculateJobDiscount(
      {} as PrintJob,
      originalPrice,
      totalPages,
      discountRules
    );

    console.log("Discount result:", discountResult);

    return {
      original: originalPrice,
      discount: discountResult.discountAmount,
      final: discountResult.finalAmount,
      hasDiscount: discountResult.discountAmount > 0,
      ruleName: discountResult.rule?.name,
    };
  };

  const handlePreviewJob = async (job: PrintJob) => {
    try {
      const url = await storageService.getFileUrl(job.id);
      if (url) {
        setPreviewJobUrl(url);
        setPreviewFileType(job.fileType);
        setShowPreviewModal(true);
      }
    } catch (err) {
      console.error("Failed to fetch preview", err);
    }
  };

  const generateQRCode = async () => {
    try {
      // Get local IP address for network access
      const localIP = await getLocalIP();
      const currentPort = window.location.port;
      const qrData = `http://${localIP}:${currentPort}?ref=upload&lang=${lang}&shop=${encodeURIComponent(localIP)}`;

      const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
        width: 256,
        margin: 2,
        color: {
          dark: "#1f2937",
          light: "#ffffff",
        },
      });

      setQrCodeUrl(qrCodeDataUrl);
      setShowQrCode(true);
    } catch (err) {
      console.error("Error generating QR code:", err);
      setError(isRtl ? "فشل إنشاء رمز QR" : "Failed to generate QR code");
    }
  };

  const getLocalIP = async (): Promise<string> => {
    try {
      const response = await fetch("/api/local-ip");
      if (!response.ok) {
        throw new Error("Failed to fetch local IP");
      }
      const data = await response.json();
      return data.ip;
    } catch (err) {
      console.error(
        "Failed to get local IP from API, falling back to hostname:",
        err,
      );
      return window.location.hostname;
    }
  };

  const downloadQRCode = () => {
    if (qrCodeUrl) {
      const link = document.createElement("a");
      link.download = `qrcode-${Date.now()}.png`;
      link.href = qrCodeUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length > 0) {
      const newFileStatuses: FileStatus[] = [];
      let hasError = false;

      for (const file of files) {
        if (!ALLOWED_TYPES.includes(file.type)) {
          setError(t("fileLimit"));
          hasError = true;
          break;
        }
        newFileStatuses.push({
          file,
          progress: 0,
          status: "pending",
          id: generateSafeId(),
        });
      }

      if (!hasError) {
        setSelectedFiles((prev) => [...prev, ...newFileStatuses]);
        setError(null);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeFile = (id: string) => {
    if (isUploading) return;
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const performUpload = async (
    fileStatus: FileStatus,
    name: string,
    phone: string,
    notes: string,
  ) => {
    const job: PrintJob = {
      id: generateSafeId(),
      customerName: name.trim(),
      phoneNumber: phone.trim(),
      notes: notes.trim(),
      fileName: fileStatus.file.name,
      fileType: fileStatus.file.type,
      fileSize: fileStatus.file.size,
      uploadDate: new Date().toISOString(),
      status: PrintStatus.PENDING,
      printPreferences: {
        colorMode: printPreferences.colorMode,
        copies: printPreferences.copies,
        paperType: printPreferences.paperType,
      },
    };

    setSelectedFiles((prev) =>
      prev.map((f) =>
        f.id === fileStatus.id ? { ...f, status: "uploading" } : f,
      ),
    );

    try {
      await storageService.saveJob(job, fileStatus.file, (progress) => {
        setSelectedFiles((prev) =>
          prev.map((f) => (f.id === fileStatus.id ? { ...f, progress } : f)),
        );
      });
      setSelectedFiles((prev) =>
        prev.map((f) =>
          f.id === fileStatus.id
            ? { ...f, status: "success", progress: 100 }
            : f,
        ),
      );
    } catch (err) {
      console.error("Upload error for file:", fileStatus.file.name, err);
      setSelectedFiles((prev) =>
        prev.map((f) =>
          f.id === fileStatus.id ? { ...f, status: "error" } : f,
        ),
      );
      throw err;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0) {
      setError(t("selectFile"));
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      for (const fileStatus of selectedFiles) {
        if (fileStatus.status === "success") continue;
        await performUpload(
          fileStatus,
          formData.name,
          formData.phone,
          formData.notes,
        );
      }
      setOverallSuccess(true);
    } catch (err) {
      setError(t("errorMsg"));
    } finally {
      setIsUploading(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const overallProgress = selectedFiles.length > 0
    ? Math.round(selectedFiles.reduce((sum, f) => sum + (f.status === "success" ? 100 : f.progress), 0) / selectedFiles.length)
    : 0;

  if (overallSuccess) {
    return (
      <>
        <style>{`
          @keyframes successPop {
            0% { transform: scale(0); opacity: 0; }
            60% { transform: scale(1.1); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes fadeSlideUp {
            0% { opacity: 0; transform: translateY(12px); }
            100% { opacity: 1; transform: translateY(0); }
          }
          .success-pop { animation: successPop 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards; }
          .fade-slide-up { animation: fadeSlideUp 0.4s ease forwards; }
        `}</style>
        <div className="max-w-md mx-auto mt-12">
          <div className="bg-white p-10 rounded-3xl shadow-2xl shadow-indigo-100/60 text-center border border-gray-100">
            <div className="success-pop w-20 h-20 mx-auto mb-5">
              <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center shadow-lg shadow-green-200">
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>

            <div className="fade-slide-up" style={{ animationDelay: "0.15s", opacity: 0 }}>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                {isRtl ? "تم الإرسال!" : "Files Sent!"}
              </h2>
              <p className="text-gray-500 mb-6 text-sm">
                {isRtl ? "وصلت ملفاتك إلى الطابعة بنجاح" : "Your files are on their way to the printer"}
              </p>
              <Button
                size="lg"
                className="w-full"
                onClick={() => {
                  setOverallSuccess(false);
                  setSelectedFiles([]);
                  setFormData({ name: "", phone: "", notes: "" });
                  setPrintPreferences({ colorMode: "color", copies: 1, paperType: shopSettings?.paperTypes?.[0]?.id || "normal" });
                }}
              >
                {isRtl ? "إرسال ملفات أخرى" : "Send more files"}
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className={`max-w-xl mx-auto ${isRtl ? "rtl" : ""}`}>
      <div className="text-center mb-5">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">
          {t("uploadTitle")}
        </h1>
        <p className="text-gray-600">{t("uploadSub")}</p>
        <div className="mt-4 flex justify-center gap-3">
          <Button
            variant="link"
            onClick={generateQRCode}
            className="gap-2"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
              ></path>
            </svg>
            {isRtl ? "إنشاء رمز QR" : "Generate QR Code"}
          </Button>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white p-5 sm:p-7 rounded-2xl shadow-xl shadow-indigo-100/40 border border-white space-y-5 mb-8"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              {t("customerName")}{" "}
              <span className="text-gray-400 font-normal">
                ({isRtl ? "اختياري" : "Optional"})
              </span>
            </label>
            <Input
              disabled={isUploading}
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder={isRtl ? "مثال: محمد علي" : "e.g. John Doe"}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              {t("phoneNumber")}{" "}
              <span className="text-gray-400 font-normal">
                ({isRtl ? "اختياري" : "Optional"})
              </span>
            </label>
            <Input
              type="tel"
              disabled={isUploading}
              value={formData.phone}
              onChange={(e) =>
                setFormData({ ...formData, phone: e.target.value })
              }
              placeholder={isRtl ? "05xxxxxxxx" : "05xxxxxxxx"}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            {t("notes")}
          </label>
          <Textarea
            disabled={isUploading}
            value={formData.notes}
            onChange={(e) =>
              setFormData({ ...formData, notes: e.target.value })
            }
            placeholder={
              isRtl
                ? "أدخل تعليمات الطباعة الإضافية هنا..."
                : "Enter additional printing instructions here..."
            }
          />
        </div>

        {/* Print Preferences Section */}
        <div className="bg-gray-50/50 p-6 rounded-2xl border border-gray-100">
          <label className="block text-sm font-semibold text-gray-800 mb-4">
            {isRtl ? "تفضيلات الطباعة" : "Print Preferences"}
          </label>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Color Mode */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                {isRtl ? "وضع الألوان" : "Color Mode"}
              </label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={printPreferences.colorMode === "color" ? "default" : "outline"}
                  disabled={isUploading}
                  onClick={() =>
                    setPrintPreferences({
                      ...printPreferences,
                      colorMode: "color",
                    })
                  }
                  className="flex-1"
                >
                  {isRtl ? "ملون" : "Color"}
                </Button>
                <Button
                  type="button"
                  variant={printPreferences.colorMode === "blackWhite" ? "default" : "outline"}
                  disabled={isUploading}
                  onClick={() =>
                    setPrintPreferences({
                      ...printPreferences,
                      colorMode: "blackWhite",
                    })
                  }
                  className="flex-1"
                >
                  {isRtl ? "أبيض وأسود" : "B&W"}
                </Button>
              </div>
            </div>

            {/* Number of Copies */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                {isRtl ? "عدد النسخ" : "Number of Copies"}
              </label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={isUploading || printPreferences.copies <= 1}
                  onClick={() =>
                    setPrintPreferences({
                      ...printPreferences,
                      copies: Math.max(1, printPreferences.copies - 1),
                    })
                  }
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M20 12H4"
                    />
                  </svg>
                </Button>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  disabled={isUploading}
                  value={printPreferences.copies}
                  onChange={(e) => {
                    const value = parseInt(e.target.value) || 1;
                    setPrintPreferences({
                      ...printPreferences,
                      copies: Math.max(1, Math.min(100, value)),
                    });
                  }}
                  className="flex-1 text-center"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={isUploading || printPreferences.copies >= 100}
                  onClick={() =>
                    setPrintPreferences({
                      ...printPreferences,
                      copies: Math.min(100, printPreferences.copies + 1),
                    })
                  }
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </Button>
              </div>
            </div>
            </div>

            {/* Paper Type */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                {isRtl ? "نوع الورق" : "Paper Type"}
              </label>
              <div className="flex flex-wrap gap-2">
                {(shopSettings?.paperTypes && shopSettings.paperTypes.length > 0
                  ? shopSettings.paperTypes
                  : [
                      { id: "normal", name: "Normal", nameAr: "عادي" },
                      { id: "glossy", name: "Glossy", nameAr: "لامع" },
                      { id: "cardboard", name: "Cardboard", nameAr: "ورق مقوى" },
                    ]
                ).map((pt) => (
                  <Button
                    key={pt.id}
                    type="button"
                    variant={printPreferences.paperType === pt.id ? "default" : "outline"}
                    disabled={isUploading}
                    onClick={() => setPrintPreferences({ ...printPreferences, paperType: pt.id })}
                    className="flex-1 min-w-[5rem]"
                  >
                    {isRtl ? pt.nameAr : pt.name}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="relative">
          <label className="block text-sm font-semibold text-gray-800 mb-2">
            {t("selectFile")}
          </label>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
              const files = Array.from(e.dataTransfer.files);
              if (files.length > 0) {
                const newFileStatuses: FileStatus[] = [];
                let hasError = false;
                for (const file of files) {
                  if (!ALLOWED_TYPES.includes(file.type)) {
                    setError(t("fileLimit"));
                    hasError = true;
                    break;
                  }
                  newFileStatuses.push({
                    file,
                    progress: 0,
                    status: "pending",
                    id: generateSafeId(),
                  });
                }
                if (!hasError) {
                  setSelectedFiles((prev) => [...prev, ...newFileStatuses]);
                  setError(null);
                }
              }
            }}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              isDragging
                ? "border-blue-500 bg-blue-50"
                : "border-gray-300 hover:border-gray-400"
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              multiple
              accept=".pdf,.docx,.xlsx,.xls,.ppt,.pptx,.jpg,.png,image/jpeg,image/png"
            />
            <div className="flex flex-col items-center">
              <svg
                className="w-10 h-10 text-gray-400 mb-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                ></path>
              </svg>
              <p className="text-sm text-gray-600 font-medium">
                {t("dragDrop")}
              </p>
              <p className="text-xs text-gray-500 mt-1">{t("fileLimit")}</p>
            </div>
          </div>
        </div>

        {selectedFiles.length > 0 && (
          <div className="space-y-3 mt-4">
            <h3 className="text-sm font-bold text-gray-900">
              {isRtl ? "الملفات المختارة" : "Selected Files"} (
              {selectedFiles.length})
            </h3>
            {selectedFiles.map((fileStatus) => (
              <div
                key={fileStatus.id}
                className="bg-gray-50 border border-gray-200 rounded-lg p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <svg
                      className="w-5 h-5 text-gray-400 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      ></path>
                    </svg>
                    <div className="truncate">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {fileStatus.file.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatSize(fileStatus.file.size)}
                        {(() => {
                          const priceInfo = getFilePriceWithDiscount(fileStatus.file);
                          if (!priceInfo) return null;
                          return (
                            <span className="ml-2">
                              {priceInfo.hasDiscount ? (
                                <span className="text-green-600 font-medium">
                                  <span className="line-through text-gray-400 mr-1">{priceInfo.original.toFixed(0)} DZD</span>
                                  {priceInfo.final.toFixed(0)} DZD
                                  <span className="text-xs ml-1">(-{priceInfo.discount.toFixed(0)})</span>
                                </span>
                              ) : (
                                <span>{priceInfo.original.toFixed(0)} DZD</span>
                              )}
                            </span>
                          );
                        })()}
                      </p>
                    </div>
                  </div>
                  {!isUploading && fileStatus.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => removeFile(fileStatus.id)}
                      className="text-gray-400 hover:text-red-500"
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
                          d="M6 18L18 6M6 6l12 12"
                        ></path>
                      </svg>
                    </button>
                  )}
                  {fileStatus.status === "success" && (
                    <svg
                      className="w-5 h-5 text-green-500"
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
                  )}
                  {fileStatus.status === "error" && (
                    <svg
                      className="w-5 h-5 text-red-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      ></path>
                    </svg>
                  )}
                </div>
                {fileStatus.status === "uploading" && (
                  <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-indigo-600 h-1.5 transition-all duration-300"
                      style={{ width: `${fileStatus.progress}%` }}
                    />
                  </div>
                )}
              </div>
            ))}

            {/* Total Price Summary with Discounts */}
            {selectedFiles.length > 0 && shopSettings?.pricing && (
              <div className="mt-4 p-4 bg-indigo-50 border border-indigo-100 rounded-xl">
                {(() => {
                  let totalOriginal = 0;
                  let totalDiscount = 0;
                  let totalFinal = 0;

                  selectedFiles.forEach((fileStatus) => {
                    const priceInfo = getFilePriceWithDiscount(fileStatus.file);
                    if (priceInfo) {
                      totalOriginal += priceInfo.original;
                      totalDiscount += priceInfo.discount;
                      totalFinal += priceInfo.final;
                    }
                  });

                  const hasDiscount = totalDiscount > 0;

                  return (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">
                          {isRtl ? "المجموع الفرعي" : "Subtotal"}
                        </span>
                        <span className="font-semibold text-gray-900">
                          {totalOriginal.toFixed(0)} DZD
                        </span>
                      </div>
                      {hasDiscount && (
                        <div className="flex justify-between items-center text-green-600">
                          <span className="text-sm">
                            {isRtl ? "الخصم" : "Discount"}
                          </span>
                          <span className="font-semibold">
                            -{totalDiscount.toFixed(0)} DZD
                          </span>
                        </div>
                      )}
                      <div className="border-t border-indigo-200 pt-2 flex justify-between items-center">
                        <span className="text-base font-bold text-gray-900">
                          {isRtl ? "الإجمالي" : "Total"}
                        </span>
                        <span className="text-lg font-bold text-indigo-600">
                          {totalFinal.toFixed(0)} DZD
                        </span>
                      </div>
                      {hasDiscount && (
                        <p className="text-xs text-green-600 text-center mt-2">
                          {isRtl
                            ? `وفرت ${totalDiscount.toFixed(0)} DZD!`
                            : `You saved ${totalDiscount.toFixed(0)} DZD!`}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100">
            {error}
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          disabled={isUploading || selectedFiles.length === 0}
          className="w-full gap-2 text-lg shadow-xl shadow-indigo-600/20"
        >
          {isUploading ? (
            <svg
              className="animate-spin h-5 w-5"
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
          ) : (
            <>
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
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                ></path>
              </svg>
              {t("uploadBtn")}
            </>
          )}
        </Button>
      </form>

      {/* Recent Uploads Section */}
      {recentJobs.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">
              {t("recentUploads")}
            </h2>
          </div>
          <div className="grid gap-3">
            {recentJobs.map((job) => (
              <Card key={job.id}>
                <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${job.status === PrintStatus.PRINTED
                      ? "bg-green-100 text-green-600"
                      : "bg-yellow-100 text-yellow-600"
                      }`}
                  >
                    {job.status === PrintStatus.PRINTED ? (
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
                          d="M5 13l4 4L19 7"
                        ></path>
                      </svg>
                    ) : (
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
                          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        ></path>
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate max-w-[150px] sm:max-w-xs">
                      {job.fileName}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                      <p>
                        {new Date(job.uploadDate).toLocaleDateString(
                          isRtl ? "ar-EG" : "en-US",
                          { numberingSystem: "latn" },
                        )}
                      </p>
                      {jobPageCounts[job.id] ? (
                        <>
                          <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                          <p className="flex items-center gap-1 font-medium bg-gray-100/80 text-gray-500 px-1.5 py-0.5 rounded">
                            <svg
                              className="w-3 h-3 text-gray-400"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                              ></path>
                            </svg>
                            {jobPageCounts[job.id]} {isRtl ? "صفحات" : "Pages"}
                          </p>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-3">
                  <div className="flex items-center gap-3">
                    {(shopSettings?.pricing || (shopSettings?.paperTypes && shopSettings.paperTypes.length > 0)) && (
                      <span className="text-sm font-bold text-green-600 bg-green-50 px-2.5 py-0.5 rounded-md border border-green-100 whitespace-nowrap">
                        {formatPrice(
                          calculatePrintPrice(
                            job,
                            shopSettings,
                            jobPageCounts[job.id] || 1,
                          ).totalPrice,
                        )}
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${job.status === PrintStatus.PRINTED
                        ? "bg-green-100 text-green-700"
                        : "bg-yellow-100 text-yellow-700"
                        }`}
                    >
                      {job.status === PrintStatus.PRINTED
                        ? t("printed")
                        : t("pending")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handlePreviewJob(job)}
                      title={isRtl ? "معاينة" : "Preview"}
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    </Button>
                    {job.status === PrintStatus.PENDING && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCancelJob(job.id)}
                        title={isRtl ? "إلغاء طباعة" : "Cancel print"}
                        className="text-destructive hover:text-destructive"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
            ))}
          </div>
          {shopSettings?.pricing && (
            <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100 flex items-start gap-3 mt-4">
              <svg
                className="w-5 h-5 text-blue-500 mt-0.5 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-xs text-blue-700 font-medium">
                {isRtl
                  ? "ملاحظة: السعر المعروض تقريبي. قد يتغير السعر النهائي حسب إعدادات المتجر الفعلية وحجم وألوان المستند النهائية التي يتم طباعتها."
                  : "Note: The estimated price is approximate. The final price may change slightly depending on the exact dimensions, color ink coverage, and store verification."}
              </p>
            </div>
          )}
        </div>
      )}

      {/* QR Code Dialog */}
      <Dialog open={showQrCode} onOpenChange={setShowQrCode}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isRtl ? "رمز QR للموقع" : "QR Code for Upload Page"}</DialogTitle>
            <DialogDescription>
              {isRtl
                ? "امسح هذا الرمز للوصول السريع إلى صفحة الرفع"
                : "Scan this code for quick access to the upload page"}
            </DialogDescription>
          </DialogHeader>
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-4">
              {isRtl
                ? "يعمل على نفس الشبكة المحلية فقط"
                : "Works on the same local network only"}
            </p>
            {qrCodeUrl && (
              <div className="flex justify-center mb-4">
                <img
                  src={qrCodeUrl}
                  alt="QR Code"
                  className="border-2 border-gray-200 rounded-lg"
                />
              </div>
            )}
            <Button
              onClick={downloadQRCode}
              className="w-full gap-2"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              {isRtl ? "تحميل رمز QR" : "Download QR Code"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Document Preview Dialog */}
      <Dialog open={showPreviewModal} onOpenChange={(open) => { if (!open) { setShowPreviewModal(false); setPreviewJobUrl(null); setPreviewFileType(null); }}}>
        <DialogContent className="sm:max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle>{isRtl ? "معاينة الملف" : "File Preview"}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 bg-muted overflow-hidden relative flex items-center justify-center">
            {previewFileType?.startsWith("image/") ? (
              <img
                src={previewJobUrl!}
                alt="Preview"
                className="max-w-full max-h-full object-contain p-4 drop-shadow-xl"
              />
            ) : previewFileType === "application/pdf" ? (
              <iframe
                src={`${previewJobUrl}#view=FitH`}
                className="w-full h-full border-0 bg-transparent"
                title="PDF Preview"
              />
            ) : (
              <div className="text-center p-8 bg-background m-8 rounded-xl shadow-sm border max-w-sm">
                <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
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
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <h4 className="text-lg font-bold mb-2">
                  {isRtl ? "المعاينة غير مدعومة" : "Preview Not Supported"}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {isRtl
                    ? "لا يمكن معاينة مستندات Office مباشرة على الشبكة المحلية المحمية. سيتم طباعتها بشكل صحيح."
                    : "Office documents cannot be previewed natively over protected local networks. They will print correctly."}
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload Overlay */}
      {isUploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 animate-in fade-in duration-200"
          style={{ background: "rgba(10,10,25,0.6)", backdropFilter: "blur(8px)" }}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm text-center animate-in zoom-in-95 duration-200">
            {/* Progress ring */}
            <div className="relative mx-auto mb-3 w-16 h-16">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="#e0e7ff" strokeWidth="7" />
                <circle
                  cx="40" cy="40" r="34"
                  fill="none"
                  stroke="#6366f1"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray="214"
                  strokeDashoffset={Math.max(4, 214 - (214 * overallProgress / 100))}
                  style={{ transition: "stroke-dashoffset 0.5s cubic-bezier(0.4, 0, 0.2, 1)" }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold text-indigo-700 transition-all duration-300">{overallProgress}%</span>
              </div>
            </div>

            <p className="text-sm font-semibold text-gray-700 mb-4">
              {isRtl ? "جاري الإرسال..." : "Uploading..."}
            </p>

            {/* Progress bar */}
            <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden mb-5 relative">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all duration-500 ease-out"
                style={{ width: `${Math.max(overallProgress, 4)}%` }}
              />
            </div>

            {/* File list (names + status only) */}
            <div className="space-y-1.5 text-left max-h-32 overflow-y-auto">
              {selectedFiles.map(f => (
                <div key={f.id} className="flex items-center gap-2">
                  {f.status === "success" ? (
                    <div className="w-3.5 h-3.5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0 animate-in fade-in duration-200">
                      <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : f.status === "uploading" ? (
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin flex-shrink-0" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-200 flex-shrink-0" />
                  )}
                  <span className={`text-xs truncate ${f.status === "success" ? "text-green-700 font-medium" : f.status === "error" ? "text-red-600" : "text-gray-600"}`}>
                    {f.file.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={cancelConfirm.isOpen} onOpenChange={(open) => { if (!open) setCancelConfirm({ isOpen: false, jobId: null }); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isRtl ? "إلغاء الطباعة" : "Cancel Print Job"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isRtl
                ? "هل أنت متأكد من إلغاء هذه الطباعة؟"
                : "Are you sure you want to cancel this print job?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isRtl ? "تراجع" : "Keep"}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancelJob} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isRtl ? "إلغاء" : "Cancel"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Toaster for notifications */}
      <Toaster />
    </div>
  );
};

export default UploadView;
