import React, { useState, useEffect, useRef } from "react";
import { Language, PrintJob, PrintStatus, ShopSettings } from "../types";
import { TRANSLATIONS } from "../constants";
import { storageService } from "../services/storageService";
import {
  calculatePrintPrice,
  getActualPageCount,
  formatPrice,
  calculateCustomerTotal,
} from "../utils/pricingUtils";
import ImageEditor from "../components/ImageEditor";

interface AdminViewProps {
  lang: Language;
  onLogout: () => void;
  onSettingsUpdate: (settings: ShopSettings) => void;
  currentSettings: ShopSettings;
}

interface CustomerGroup {
  key: string;
  customerName: string;
  phoneNumber: string;
  jobs: PrintJob[];
  latestDate: string;
}

const AdminView: React.FC<AdminViewProps> = ({
  lang,
  onLogout,
  onSettingsUpdate,
  currentSettings,
}) => {
  // Safe translation function
  const t = (key: string) => {
    if (!TRANSLATIONS[key]) {
      console.warn(`Missing translation key: ${key}`);
      return key;
    }
    return TRANSLATIONS[key][lang] || TRANSLATIONS[key]["en"] || key;
  };

  const isRtl = lang === "ar";
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"jobs" | "settings">("jobs");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );

  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());

  const [editingJob, setEditingJob] = useState<PrintJob | null>(null);
  const [editingBlob, setEditingBlob] = useState<Blob | null>(null);

  const [shopName, setShopName] = useState(currentSettings.shopName);
  const [logoUrl, setLogoUrl] = useState<string | null>(
    currentSettings.logoUrl,
  );
  const [colorPrice, setColorPrice] = useState(
    currentSettings.pricing?.colorPerPage || 30.0,
  );
  const [blackWhitePrice, setBlackWhitePrice] = useState(
    currentSettings.pricing?.blackWhitePerPage || 15.0,
  );
  const [jobPageCounts, setJobPageCounts] = useState<{
    [jobId: string]: number;
  }>({});

  useEffect(() => {
    loadJobs();
  }, []);

  // Load current settings when component mounts
  useEffect(() => {
    setShopName(currentSettings.shopName);
    setLogoUrl(currentSettings.logoUrl);
    setColorPrice(currentSettings.pricing?.colorPerPage || 30.0);
    setBlackWhitePrice(currentSettings.pricing?.blackWhitePerPage || 15.0);
  }, [currentSettings]);

  const loadJobs = async () => {
    setLoading(true);
    const data = await storageService.getMetadata();
    const grouped = data.reduce(
      (acc: { [key: string]: CustomerGroup }, job) => {
        const name = job.customerName || "";
        const phone = job.phoneNumber || "";
        const key = `${name}-${phone}` || "anonymous-group";

        if (!acc[key]) {
          acc[key] = {
            key,
            customerName: name,
            phoneNumber: phone,
            jobs: [],
            latestDate: job.uploadDate,
          };
        }
        acc[key].jobs.push(job);
        if (new Date(job.uploadDate) > new Date(acc[key].latestDate)) {
          acc[key].latestDate = job.uploadDate;
        }
        return acc;
      },
      {},
    );

    const sortedGroups = Object.values(grouped).sort(
      (a, b) =>
        new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime(),
    );

    sortedGroups.forEach((group) => {
      group.jobs.sort(
        (a, b) =>
          new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime(),
      );
    });

    setGroups(sortedGroups);
    setLoading(false);

    // Count pages for all jobs
    countPagesForAllJobs(sortedGroups);
  };

  const countPagesForAllJobs = async (groups: CustomerGroup[]) => {
    const pageCounts: { [jobId: string]: number } = {};

    for (const group of groups) {
      for (const job of group.jobs) {
        try {
          const url = await storageService.getFileUrl(job.id);
          if (url) {
            const response = await fetch(url);
            const blob = await response.blob();
            const file = new File([blob], job.fileName, { type: job.fileType });
            const pageCount = await getActualPageCount(file);
            pageCounts[job.id] = pageCount;
          } else {
            pageCounts[job.id] = 1;
          }
        } catch (error) {
          console.error(`Error counting pages for job ${job.id}:`, error);
          pageCounts[job.id] = 1;
        }
      }
    }

    setJobPageCounts(pageCounts);
  };

  const toggleGroup = (key: string) => {
    const newCollapsed = new Set(collapsedGroups);
    if (newCollapsed.has(key)) {
      newCollapsed.delete(key);
    } else {
      newCollapsed.add(key);
    }
    setCollapsedGroups(newCollapsed);
  };

  const toggleSelectJob = (id: string) => {
    const newSelected = new Set(selectedJobIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedJobIds(newSelected);
  };

  const toggleSelectGroup = (
    jobs: PrintJob[],
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const jobIds = jobs.map((j) => j.id);
    const allSelectedInGroup = jobIds.every((id) => selectedJobIds.has(id));

    const newSelected = new Set(selectedJobIds);
    if (allSelectedInGroup) {
      jobIds.forEach((id) => newSelected.delete(id));
    } else {
      jobIds.forEach((id) => newSelected.add(id));
    }
    setSelectedJobIds(newSelected);
  };

  const handleDownload = async (job: PrintJob) => {
    const url = await storageService.getFileUrl(job.id);
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.download = job.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handlePrint = async (job: PrintJob) => {
    const url = await storageService.getFileUrl(job.id);
    if (!url) return;

    if (job.fileType === "application/pdf") {
      window.open(url, "_blank");
      return;
    }

    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head><title>Print - ${job.fileName}</title></head>
          <body style="margin:0; display:flex; justify-content:center;">
            <img src="${url}" style="max-width:100%; max-height:100vh;" onload="window.print(); window.close();" />
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  const handleBulkPrint = async () => {
    const selectedJobs = groups
      .flatMap((g) => g.jobs)
      .filter((j) => selectedJobIds.has(j.id));
    if (selectedJobs.length === 0) return;

    const images = selectedJobs.filter((j) => j.fileType.includes("image"));
    const pdfs = selectedJobs.filter((j) => j.fileType === "application/pdf");

    if (images.length > 0) {
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        let imagesHtml = "";
        for (const img of images) {
          const url = await storageService.getFileUrl(img.id);
          imagesHtml += `<div style="page-break-after: always; display: flex; justify-content: center; align-items: center; height: 100vh;"><img src="${url}" style="max-width: 100%; max-height: 100%;" /></div>`;
        }
        printWindow.document.write(`
          <html>
            <head><title>Bulk Print Images</title></head>
            <body style="margin:0;">
              ${imagesHtml}
              <script>window.onload = () => { window.print(); window.close(); }</script>
            </body>
          </html>
        `);
        printWindow.document.close();
      }
    }

    for (const pdf of pdfs) {
      const url = await storageService.getFileUrl(pdf.id);
      if (url) window.open(url, "_blank");
    }
  };

  const handleBulkDownload = async () => {
    const selectedIds = Array.from(selectedJobIds);
    for (let i = 0; i < selectedIds.length; i++) {
      const job = groups
        .flatMap((g) => g.jobs)
        .find((j) => j.id === selectedIds[i]);
      if (job) {
        await handleDownload(job);
        if (selectedIds.length > 1)
          await new Promise((r) => setTimeout(r, 200));
      }
    }
  };

  const handleBulkDelete = async () => {
    const count = selectedJobIds.size;
    if (
      confirm(
        isRtl
          ? `هل أنت متأكد من حذف ${count} ملف؟`
          : `Are you sure you want to delete ${count} files?`,
      )
    ) {
      const ids = Array.from(selectedJobIds);
      for (const id of ids) {
        await storageService.deleteJob(id);
      }
      setSelectedJobIds(new Set());
      loadJobs();
    }
  };

  const handleBulkStatusUpdate = async () => {
    const ids = Array.from(selectedJobIds);
    for (const id of ids) {
      await storageService.updateStatus(id, PrintStatus.PRINTED);
    }
    setSelectedJobIds(new Set());
    loadJobs();
  };

  const handleEdit = async (job: PrintJob) => {
    const url = await storageService.getFileUrl(job.id);
    if (url && job.fileType.includes("image")) {
      const res = await fetch(url);
      const blob = await res.blob();
      setEditingJob(job);
      setEditingBlob(blob);
    } else {
      alert(
        isRtl
          ? "تحرير الصور متاح لملفات الصور فقط."
          : "Editing is only for image files.",
      );
    }
  };

  const handleSaveEditedImage = async (newBlob: Blob) => {
    if (editingJob) {
      try {
        const file = new File([newBlob], editingJob.fileName, {
          type: newBlob.type,
        });
        await storageService.updateJobFile(editingJob.id, file);
        setEditingJob(null);
        setEditingBlob(null);
        loadJobs();
      } catch (err) {
        console.error("Failed to update job file:", err);
        alert(isRtl ? "فشل تحديث الملف." : "Failed to update file.");
      }
    }
  };

  const handleStatusToggle = async (job: PrintJob) => {
    const newStatus =
      job.status === PrintStatus.PENDING
        ? PrintStatus.PRINTED
        : PrintStatus.PENDING;
    await storageService.updateStatus(job.id, newStatus);
    loadJobs();
  };

  const handleDelete = async (id: string) => {
    if (
      confirm(isRtl ? "هل أنت متأكد من الحذف؟" : "Delete this job and file?")
    ) {
      await storageService.deleteJob(id);
      const newSelected = new Set(selectedJobIds);
      newSelected.delete(id);
      setSelectedJobIds(newSelected);
      loadJobs();
    }
  };

  const saveSettings = async () => {
    await storageService.saveSettings({
      shopName,
      pricing: {
        colorPerPage: colorPrice,
        blackWhitePerPage: blackWhitePrice,
      },
    });
    onSettingsUpdate({
      ...currentSettings,
      shopName,
      pricing: {
        colorPerPage: colorPrice,
        blackWhitePerPage: blackWhitePrice,
      },
    });
    alert(isRtl ? "تم الحفظ" : "Saved");
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const newLogoUrl = await storageService.uploadLogo(file);
        setLogoUrl(newLogoUrl);
        onSettingsUpdate({ ...currentSettings, logoUrl: newLogoUrl });
      } catch (err) {
        alert(isRtl ? "فشل رفع الشعار" : "Failed to upload logo");
      }
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getFileExtension = (filename: string) => {
    return filename.split(".").pop()?.toUpperCase() || "";
  };

  const isWordFile = (fileType: string) => {
    return (
      fileType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      fileType === "application/msword"
    );
  };

  return (
    <div
      className={`max-w-7xl mx-auto px-4 pb-32 ${
        isRtl ? "rtl text-right" : ""
      }`}
    >
      {editingJob && editingBlob && (
        <ImageEditor
          imageBlob={editingBlob}
          lang={lang}
          onSave={handleSaveEditedImage}
          onCancel={() => {
            setEditingJob(null);
            setEditingBlob(null);
          }}
        />
      )}

      {/* Bulk Action Bar */}
      {selectedJobIds.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[90] bg-gray-900/90 backdrop-blur-md text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-6 animate-slide-up border border-white/10 max-w-[95vw] md:max-w-max">
          <div className="flex items-center gap-3 border-r border-white/20 pr-6 mr-2">
            <span className="bg-indigo-500 text-white w-7 h-7 rounded-full flex items-center justify-center font-bold text-sm">
              {selectedJobIds.size}
            </span>
            <span className="text-sm font-medium whitespace-nowrap">
              {t("selectedItems")}
            </span>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            <button
              onClick={handleBulkPrint}
              title={t("bulkPrint")}
              className="flex flex-col items-center gap-1 hover:text-indigo-400 transition"
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
                  d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                ></path>
              </svg>
              <span className="text-[10px] hidden sm:block uppercase tracking-wider font-bold">
                {t("print")}
              </span>
            </button>
            <button
              onClick={handleBulkDownload}
              title={t("bulkDownload")}
              className="flex flex-col items-center gap-1 hover:text-indigo-400 transition"
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
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                ></path>
              </svg>
              <span className="text-[10px] hidden sm:block uppercase tracking-wider font-bold">
                {t("download")}
              </span>
            </button>
            <button
              onClick={handleBulkStatusUpdate}
              title={t("markAsPrinted")}
              className="flex flex-col items-center gap-1 hover:text-green-400 transition"
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
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                ></path>
              </svg>
              <span className="text-[10px] hidden sm:block uppercase tracking-wider font-bold">
                {t("printed")}
              </span>
            </button>
            <button
              onClick={handleBulkDelete}
              title={t("bulkDelete")}
              className="flex flex-col items-center gap-1 hover:text-red-400 transition"
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
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                ></path>
              </svg>
              <span className="text-[10px] hidden sm:block uppercase tracking-wider font-bold">
                {t("delete")}
              </span>
            </button>
          </div>

          <button
            onClick={() => setSelectedJobIds(new Set())}
            className="ml-4 p-1 hover:bg-white/10 rounded-full transition"
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
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t("dashboard")}</h1>
          <p className="text-gray-600">
            {isRtl
              ? "إدارة المحل وطلبات الطباعة"
              : "Manage your shop and print requests"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => (window.location.hash = "")}
            className="bg-indigo-50 text-indigo-600 px-4 py-2 rounded-lg hover:bg-indigo-100 transition flex items-center gap-2 text-sm font-semibold"
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
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
              ></path>
            </svg>
            {isRtl ? "صفحة الرفع" : "Upload Page"}
          </button>
          <button
            onClick={onLogout}
            className="bg-gray-100 text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-200 transition flex items-center gap-2 text-sm font-semibold"
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
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              ></path>
            </svg>
            {t("logout")}
          </button>
        </div>
      </div>

      <div className="flex border-b border-gray-200 mb-6 gap-6">
        <button
          onClick={() => setActiveTab("jobs")}
          className={`pb-4 px-2 text-sm font-semibold transition-all ${
            activeTab === "jobs"
              ? "border-b-2 border-indigo-600 text-indigo-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {t("jobs")}
        </button>
        <button
          onClick={() => setActiveTab("settings")}
          className={`pb-4 px-2 text-sm font-semibold transition-all ${
            activeTab === "settings"
              ? "border-b-2 border-indigo-600 text-indigo-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {t("settings")}
        </button>
      </div>

      <div className="min-h-[400px]">
        {activeTab === "jobs" ? (
          <>
            {loading ? (
              <div className="p-12 text-center text-gray-500">
                Loading from server...
              </div>
            ) : groups.length === 0 ? (
              <div className="p-12 text-center text-gray-500 bg-white rounded-2xl border border-gray-200">
                <p>{t("noJobs")}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {groups.map((group) => {
                  const isCollapsed = collapsedGroups.has(group.key);
                  const isExpanded = !isCollapsed;
                  const pendingCount = group.jobs.filter(
                    (j) => j.status === PrintStatus.PENDING,
                  ).length;
                  const allInGroupSelected = group.jobs.every((id) =>
                    selectedJobIds.has(id.id),
                  );
                  const customerTotal = currentSettings.pricing
                    ? calculateCustomerTotal(
                        group.jobs,
                        currentSettings,
                        jobPageCounts,
                      )
                    : 0;

                  return (
                    <div
                      key={group.key}
                      className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
                    >
                      <div className="flex items-center border-b border-gray-100 bg-white group/header">
                        <div className="px-4 py-4 flex items-center">
                          <input
                            type="checkbox"
                            className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            checked={
                              allInGroupSelected && group.jobs.length > 0
                            }
                            onChange={(e) => toggleSelectGroup(group.jobs, e)}
                          />
                        </div>
                        <button
                          onClick={() => toggleGroup(group.key)}
                          className="flex-1 px-2 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-4 flex-1 min-w-0">
                            <div
                              className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                pendingCount > 0
                                  ? "bg-indigo-100 text-indigo-600"
                                  : "bg-gray-100 text-gray-400"
                              }`}
                            >
                              <svg
                                className="w-6 h-6"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                                ></path>
                              </svg>
                            </div>
                            <div className="truncate text-left">
                              <h3 className="text-lg font-bold text-gray-900 truncate">
                                {group.customerName ||
                                  (isRtl ? "بدون اسم" : "No Name")}
                              </h3>
                              <p className="text-sm text-gray-500">
                                {group.phoneNumber ||
                                  (isRtl ? "بدون هاتف" : "No Phone")}
                              </p>
                              {customerTotal > 0 && (
                                <p className="text-sm font-bold text-green-600 mt-1">
                                  {isRtl ? "الإجمالي:" : "Total:"}{" "}
                                  {formatPrice(customerTotal)}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-3 py-1 text-xs font-bold rounded-full ${
                                pendingCount > 0
                                  ? "bg-yellow-100 text-yellow-700"
                                  : "bg-green-100 text-green-700"
                              }`}
                            >
                              {group.jobs.length} {isRtl ? "ملف" : "files"}
                            </span>
                            <svg
                              className={`w-5 h-5 text-gray-400 transition-transform ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M19 9l-7 7-7-7"
                              ></path>
                            </svg>
                          </div>
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="border-t border-gray-100 bg-gray-50/50 overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead className="bg-gray-50/80 border-b border-gray-200">
                              <tr>
                                <th className="px-4 py-3 w-10">
                                  <input
                                    type="checkbox"
                                    className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                    checked={
                                      allInGroupSelected &&
                                      group.jobs.length > 0
                                    }
                                    onChange={(e) =>
                                      toggleSelectGroup(group.jobs, e)
                                    }
                                  />
                                </th>
                                <th
                                  className={`px-6 py-3 text-xs font-semibold text-gray-500 uppercase ${
                                    isRtl ? "text-right" : ""
                                  }`}
                                >
                                  {t("fileName")}
                                </th>
                                <th
                                  className={`px-6 py-3 text-xs font-semibold text-gray-500 uppercase ${
                                    isRtl ? "text-right" : ""
                                  }`}
                                >
                                  {t("status")}
                                </th>
                                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">
                                  {t("actions")}
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {group.jobs.map((job) => {
                                const isSelected = selectedJobIds.has(job.id);
                                const ext = getFileExtension(job.fileName);
                                const wordFile = isWordFile(job.fileType);

                                return (
                                  <tr
                                    key={job.id}
                                    className={`hover:bg-indigo-50/30 transition-colors ${
                                      isSelected ? "bg-indigo-50/50" : ""
                                    }`}
                                  >
                                    <td className="px-4 py-4">
                                      <input
                                        type="checkbox"
                                        className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                        checked={isSelected}
                                        onChange={() => toggleSelectJob(job.id)}
                                      />
                                    </td>
                                    <td className="px-6 py-3">
                                      <div className="flex items-center gap-3">
                                        {/* File type badge */}
                                        <span
                                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 ${
                                            ext === "PDF"
                                              ? "bg-red-50 text-red-600 border-red-100"
                                              : ext === "DOCX" || ext === "DOC"
                                                ? "bg-blue-50 text-blue-600 border-blue-100"
                                                : "bg-indigo-50 text-indigo-600 border-indigo-100"
                                          }`}
                                        >
                                          {ext}
                                        </span>

                                        {/* File name and info */}
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <div className="text-sm font-medium text-gray-900 truncate">
                                              {job.fileName}
                                            </div>
                                            <span className="text-xs text-gray-400 flex-shrink-0">
                                              {formatSize(job.fileSize)}
                                            </span>
                                            {job.printPreferences && (
                                              <>
                                                <span
                                                  className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                                                    job.printPreferences
                                                      .colorMode ===
                                                    "blackWhite"
                                                      ? "bg-gray-100 text-gray-700"
                                                      : "bg-blue-100 text-blue-700"
                                                  }`}
                                                >
                                                  {job.printPreferences
                                                    .colorMode === "blackWhite"
                                                    ? isRtl
                                                      ? "أبيض وأسود"
                                                      : "B&W"
                                                    : isRtl
                                                      ? "ملون"
                                                      : "Color"}
                                                </span>
                                                {job.printPreferences.copies >
                                                  1 && (
                                                  <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium flex-shrink-0">
                                                    {
                                                      job.printPreferences
                                                        .copies
                                                    }
                                                    x {isRtl ? "نسخ" : "copies"}
                                                  </span>
                                                )}
                                              </>
                                            )}
                                            {currentSettings.pricing && (
                                              <span className="text-sm font-bold text-green-600 flex-shrink-0">
                                                {formatPrice(
                                                  calculatePrintPrice(
                                                    job,
                                                    currentSettings,
                                                    jobPageCounts[job.id] || 1,
                                                  ).totalPrice,
                                                )}
                                              </span>
                                            )}
                                          </div>
                                          {job.notes && (
                                            <div className="text-xs text-indigo-600 italic mt-0.5">
                                              {job.notes}
                                            </div>
                                          )}
                                          {currentSettings.pricing && (
                                            <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                                              <span>
                                                {isRtl ? "صفحات:" : "Pages:"}{" "}
                                                {jobPageCounts[job.id] || 1}
                                              </span>
                                              <span>
                                                {formatPrice(
                                                  calculatePrintPrice(
                                                    job,
                                                    currentSettings,
                                                    jobPageCounts[job.id] || 1,
                                                  ).pricePerPage,
                                                )}
                                                /{isRtl ? "صفحة" : "page"}
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-6 py-3">
                                      <span
                                        className={`px-2 py-1 text-xs font-bold rounded-full ${
                                          job.status === PrintStatus.PRINTED
                                            ? "bg-green-100 text-green-700"
                                            : "bg-yellow-100 text-yellow-700"
                                        }`}
                                      >
                                        {job.status === PrintStatus.PRINTED
                                          ? t("printed")
                                          : t("pending")}
                                      </span>
                                    </td>
                                    <td className="px-6 py-3">
                                      <div className="flex gap-1">
                                        {!wordFile && (
                                          <button
                                            onClick={() => handlePrint(job)}
                                            title={t("print")}
                                            className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg transition"
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
                                                d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                                              ></path>
                                            </svg>
                                          </button>
                                        )}
                                        <button
                                          onClick={() => handleEdit(job)}
                                          title={t("edit")}
                                          className="p-1.5 text-orange-600 hover:bg-orange-100 rounded-lg transition"
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
                                              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                            ></path>
                                          </svg>
                                        </button>
                                        <button
                                          onClick={() => handleDownload(job)}
                                          title={t("download")}
                                          className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-lg transition"
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
                                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                                            ></path>
                                          </svg>
                                        </button>
                                        <button
                                          onClick={() =>
                                            handleStatusToggle(job)
                                          }
                                          title={t("status")}
                                          className="p-1.5 text-green-600 hover:bg-green-100 rounded-lg transition"
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
                                              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                            ></path>
                                          </svg>
                                        </button>
                                        <button
                                          onClick={() => handleDelete(job.id)}
                                          title={t("delete")}
                                          className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg transition"
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
                                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                            ></path>
                                          </svg>
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-2xl space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                {t("shopName")}
              </label>
              <input
                type="text"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 transition"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                {t("shopLogo")}
              </label>
              <div className="flex items-center gap-4">
                {logoUrl && (
                  <div className="w-16 h-16 rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
                    <img
                      src={logoUrl}
                      alt="Logo Preview"
                      className="w-full h-full object-contain"
                    />
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                />
              </div>
            </div>

            {/* Pricing Settings */}
            <div className="border-t border-gray-200 pt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {isRtl ? "أسعار الطباعة" : "Pricing Settings"}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    {isRtl
                      ? "سعر الطباعة الملونة (لكل صفحة)"
                      : "Color Printing (per page)"}
                  </label>
                  <div className="flex items-center">
                    <span className="text-gray-500 mr-2">DZD</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 transition"
                      value={colorPrice}
                      onChange={(e) =>
                        setColorPrice(parseFloat(e.target.value) || 0)
                      }
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    {isRtl
                      ? "سعر الطباعة بالأبيض والأسود (لكل صفحة)"
                      : "Black & White Printing (per page)"}
                  </label>
                  <div className="flex items-center">
                    <span className="text-gray-500 mr-2">DZD</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 transition"
                      value={blackWhitePrice}
                      onChange={(e) =>
                        setBlackWhitePrice(parseFloat(e.target.value) || 0)
                      }
                    />
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={saveSettings}
              className="bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-700 transition shadow-md shadow-indigo-100"
            >
              {t("saveSettings")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminView;
