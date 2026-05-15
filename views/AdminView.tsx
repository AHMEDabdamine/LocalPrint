import React, { useState, useEffect, useRef } from "react";
import { Language, PrintJob, PrintStatus, ShopSettings, DiscountRule, DiscountType, ConditionType, PaperType } from "../types";
import { TRANSLATIONS } from "../constants";
import { storageService } from "../services/storageService";
import {
  calculatePrintPrice,
  getActualPageCount,
  formatPrice,
  calculateCustomerTotal,
  calculateJobDiscount,
  calculateCustomerTotalWithDiscounts,
} from "../utils/pricingUtils";
import { formatRelativeTime } from "../utils/timeUtils";
import ImageEditor from "../components/ImageEditor";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";

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
  // toast() imported from use-toast, called directly

  // Confirm dialog states
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [singleDeleteConfirm, setSingleDeleteConfirm] = useState<string | null>(null);

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
  const [paperTypes, setPaperTypes] = useState<PaperType[]>(
    currentSettings.paperTypes && currentSettings.paperTypes.length > 0
      ? currentSettings.paperTypes
      : [
          { id: "normal", name: "Normal", nameAr: "عادي", colorPerPage: currentSettings.pricing?.colorPerPage || 30.0, blackWhitePerPage: currentSettings.pricing?.blackWhitePerPage || 15.0 },
          { id: "glossy", name: "Glossy", nameAr: "لامع", colorPerPage: currentSettings.pricing?.glossyPerPage || 50.0, blackWhitePerPage: currentSettings.pricing?.glossyPerPage || 50.0 },
          { id: "cardboard", name: "Cardboard", nameAr: "ورق مقوى", colorPerPage: currentSettings.pricing?.cardboardPerPage || 40.0, blackWhitePerPage: currentSettings.pricing?.cardboardPerPage || 40.0 },
        ]
  );
  const [editingPaperTypeId, setEditingPaperTypeId] = useState<string | null>(null);
  const [editingPaperTypeForm, setEditingPaperTypeForm] = useState<{ name: string; nameAr: string; colorPerPage: number; blackWhitePerPage: number } | null>(null);
  const [showAddPaperTypeForm, setShowAddPaperTypeForm] = useState(false);
  const [newPaperTypeForm, setNewPaperTypeForm] = useState({ name: "", nameAr: "", colorPerPage: 30, blackWhitePerPage: 15 });
  const [showPasswords, setShowPasswords] = useState({ current: false, newPass: false, confirm: false });
  const [jobPageCounts, setJobPageCounts] = useState<{
    [jobId: string]: number;
  }>({});
  const [discountRules, setDiscountRules] = useState<DiscountRule[]>([]);

  // Tracks which job's copies stepper is open
  const [editingCopiesJobId, setEditingCopiesJobId] = useState<string | null>(
    null,
  );
  // Tracks which job is currently saving preferences (shows spinner)
  const [savingPrefsJobId, setSavingPrefsJobId] = useState<string | null>(null);
  // Local copies value while editing
  const [editingCopiesValue, setEditingCopiesValue] = useState<number>(1);

  const [searchQuery, setSearchQuery] = useState("");
  const [passwordForm, setPasswordForm] = useState({ current: "", newPass: "", confirm: "" });
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const [isEditingRule, setIsEditingRule] = useState(false);
  const [editingRule, setEditingRule] = useState<DiscountRule | null>(null);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleFormData, setRuleFormData] = useState<Partial<DiscountRule>>({
    name: "",
    discount_type: "percent",
    discount_value: 10,
    condition_type: "pages",
    threshold: 50,
    max_discount_cap: null,
    priority: 0,
    is_active: true,
  });
  const [deleteRuleConfirm, setDeleteRuleConfirm] = useState<string | null>(null);

  useEffect(() => {
    loadJobs();
    loadDiscountRules();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (activeTab === "jobs") loadJobs();
    }, 30000);
    return () => clearInterval(interval);
  }, [activeTab]);

  // Load current settings when component mounts
  useEffect(() => {
    setShopName(currentSettings.shopName);
    setLogoUrl(currentSettings.logoUrl);
    if (currentSettings.paperTypes && currentSettings.paperTypes.length > 0) {
      setPaperTypes(currentSettings.paperTypes);
    }
  }, [currentSettings]);

  const loadJobs = async () => {
    setLoading(true);
    const data = await storageService.getMetadata();
    const grouped = data.reduce(
      (acc: { [key: string]: CustomerGroup }, job) => {
        const name = job.customerName?.trim() || "";
        const phone = job.phoneNumber?.trim() || "";

        let key = `${name}-${phone}`;
        if (!name && !phone) {
          // Group anonymous files by the exact minute they were uploaded
          const timeKey = new Date(job.uploadDate).toISOString().slice(0, 16);
          key = `anon-${timeKey}`;
        }

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

    // Pre-seed with server-provided page counts (already accurate for PDFs)
    for (const group of groups) {
      for (const job of group.jobs) {
        if (job.pageCount && job.pageCount > 0) {
          pageCounts[job.id] = job.pageCount;
        }
      }
    }

    // Only fetch & count client-side for jobs without a server page count
    for (const group of groups) {
      for (const job of group.jobs) {
        if (pageCounts[job.id]) continue; // already have it
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

  // Discount Rules Functions
  const loadDiscountRules = async () => {
    try {
      const rules = await storageService.getDiscountRules();
      setDiscountRules(rules);
    } catch (err) {
      console.error("Failed to load discount rules:", err);
    }
  };

  const handleAddRule = () => {
    setIsEditingRule(false);
    setEditingRule(null);
    setRuleFormData({
      name: "",
      discount_type: "percent",
      discount_value: 10,
      condition_type: "pages",
      threshold: 50,
      max_discount_cap: null,
      priority: 0,
      is_active: true,
    });
    setShowRuleForm(true);
  };

  const handleEditRule = (rule: DiscountRule) => {
    setIsEditingRule(true);
    setEditingRule(rule);
    setRuleFormData({ ...rule });
    setShowRuleForm(true);
  };

  const handleSaveRule = async () => {
    try {
      if (!ruleFormData.name || ruleFormData.discount_value === undefined || ruleFormData.threshold === undefined) {
        toast({ title: isRtl ? "يرجى ملء جميع الحقول المطلوبة" : "Please fill all required fields", variant: "destructive" });
        return;
      }

      const ruleData: DiscountRule = {
        id: isEditingRule && editingRule ? editingRule.id : Math.random().toString(36).substring(2, 9),
        name: ruleFormData.name!,
        discount_type: ruleFormData.discount_type as DiscountType,
        discount_value: Number(ruleFormData.discount_value),
        condition_type: ruleFormData.condition_type as ConditionType,
        threshold: Number(ruleFormData.threshold),
        max_discount_cap: ruleFormData.max_discount_cap ? Number(ruleFormData.max_discount_cap) : null,
        priority: Number(ruleFormData.priority) || 0,
        is_active: ruleFormData.is_active !== false,
      };

      if (isEditingRule && editingRule) {
        await storageService.updateDiscountRule(editingRule.id, ruleData);
        toast({ title: isRtl ? "تم تحديث القاعدة بنجاح" : "Rule updated successfully", variant: "success" });
      } else {
        await storageService.createDiscountRule(ruleData);
        toast({ title: isRtl ? "تم إنشاء القاعدة بنجاح" : "Rule created successfully", variant: "success" });
      }

      setShowRuleForm(false);
      loadDiscountRules();
    } catch (err) {
      console.error("Failed to save discount rule:", err);
      toast({ title: isRtl ? "فشل حفظ القاعدة" : "Failed to save rule", variant: "destructive" });
    }
  };

  const handleDeleteRule = async (id: string) => {
    setDeleteRuleConfirm(id);
  };

  const confirmDeleteRule = async () => {
    if (deleteRuleConfirm) {
      try {
        await storageService.deleteDiscountRule(deleteRuleConfirm);
        toast({ title: isRtl ? "تم حذف القاعدة بنجاح" : "Rule deleted successfully", variant: "success" });
        loadDiscountRules();
      } catch (err) {
        console.error("Failed to delete discount rule:", err);
        toast({ title: isRtl ? "فشل حذف القاعدة" : "Failed to delete rule", variant: "destructive" });
      }
      setDeleteRuleConfirm(null);
    }
  };

  const handleToggleRuleActive = async (rule: DiscountRule) => {
    try {
      await storageService.updateDiscountRule(rule.id, { is_active: !rule.is_active });
      loadDiscountRules();
      toast({ title: !rule.is_active ? (isRtl ? "تم تفعيل القاعدة" : "Rule activated") : (isRtl ? "تم تعطيل القاعدة" : "Rule deactivated"), variant: "success" });
    } catch (err) {
      console.error("Failed to toggle rule:", err);
      toast({ title: isRtl ? "فشل تحديث القاعدة" : "Failed to update rule", variant: "destructive" });
    }
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

  const handleBulkDelete = () => {
    setBulkDeleteConfirm(true);
  };

  const confirmBulkDelete = async () => {
    const ids = Array.from(selectedJobIds);
    for (const id of ids) {
      await storageService.deleteJob(id);
    }
    setSelectedJobIds(new Set());
    setBulkDeleteConfirm(false);
    loadJobs();
    toast({ title: isRtl ? `تم حذف ${ids.length} ملفات` : `${ids.length} files deleted successfully`, variant: "success" });
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
      toast({ title: isRtl ? "تحرير الصور متاح لملفات الصور فقط." : "Editing is only for image files.", variant: "destructive" });
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
        toast({ title: isRtl ? "تم تحديث الملف بنجاح" : "File updated successfully", variant: "success" });
      } catch (err) {
        console.error("Failed to update job file:", err);
        toast({ title: isRtl ? "فشل تحديث الملف." : "Failed to update file.", variant: "destructive" });
      }
    }
  };

  const handleStatusChange = async (jobId: string, newStatus: PrintStatus) => {
    await storageService.updateStatus(jobId, newStatus);
    loadJobs();
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess(false);
    if (passwordForm.newPass !== passwordForm.confirm) {
      setPasswordError(isRtl ? "كلمات المرور الجديدة غير متطابقة" : "New passwords do not match");
      return;
    }
    if (passwordForm.newPass.length < 4) {
      setPasswordError(isRtl ? "يجب أن تكون كلمة المرور 4 أحرف على الأقل" : "Password must be at least 4 characters");
      return;
    }
    try {
      await storageService.changePassword(passwordForm.current, passwordForm.newPass);
      setPasswordSuccess(true);
      setPasswordForm({ current: "", newPass: "", confirm: "" });
      toast({ title: isRtl ? "تم تغيير كلمة المرور بنجاح" : "Password changed successfully", variant: "success" });
    } catch {
      setPasswordError(isRtl ? "كلمة المرور الحالية غير صحيحة" : "Current password is incorrect");
    }
  };

  const handleDelete = (id: string) => {
    setSingleDeleteConfirm(id);
  };

  const confirmSingleDelete = async () => {
    if (singleDeleteConfirm) {
      await storageService.deleteJob(singleDeleteConfirm);
      const newSelected = new Set(selectedJobIds);
      newSelected.delete(singleDeleteConfirm);
      setSelectedJobIds(newSelected);
      setSingleDeleteConfirm(null);
      loadJobs();
      toast({ title: isRtl ? "تم الحذف بنجاح" : "Deleted successfully", variant: "success" });
    }
  };

  // Toggle color mode for a job inline
  const handleToggleColorMode = async (job: PrintJob) => {
    if (savingPrefsJobId === job.id) return;
    const newMode =
      job.printPreferences?.colorMode === "blackWhite" ? "color" : "blackWhite";
    const newCopies = job.printPreferences?.copies || 1;
    const paperType = job.printPreferences?.paperType || "normal";
    setSavingPrefsJobId(job.id);
    try {
      await storageService.updateJobPreferences(job.id, {
        colorMode: newMode,
        copies: newCopies,
        paperType,
      });
      setGroups((prev) =>
        prev.map((g) => ({
          ...g,
          jobs: g.jobs.map((j) =>
            j.id === job.id
              ? { ...j, printPreferences: { colorMode: newMode, copies: newCopies, paperType } }
              : j,
          ),
        })),
      );
    } catch (err) {
      console.error("Failed to update color mode", err);
    } finally {
      setSavingPrefsJobId(null);
    }
  };

  // Save updated copies count for a job
  const handleSaveCopies = async (job: PrintJob, copies: number) => {
    if (savingPrefsJobId === job.id) return;
    const safeCopies = Math.max(1, Math.min(100, copies));
    const colorMode = job.printPreferences?.colorMode || "color";
    const paperType = job.printPreferences?.paperType || "normal";
    setSavingPrefsJobId(job.id);
    setEditingCopiesJobId(null);
    try {
      await storageService.updateJobPreferences(job.id, {
        colorMode,
        copies: safeCopies,
        paperType,
      });
      setGroups((prev) =>
        prev.map((g) => ({
          ...g,
          jobs: g.jobs.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  printPreferences: { colorMode, copies: safeCopies },
                }
              : j,
          ),
        })),
      );
    } catch (err) {
      console.error("Failed to update copies", err);
    } finally {
      setSavingPrefsJobId(null);
    }
  };

  const getPaperTypeName = (id: string) => {
    const pt = paperTypes.find(p => p.id === id);
    if (!pt) return isRtl ? "عادي" : "Normal";
    return isRtl ? pt.nameAr : pt.name;
  };

  const handleAddPaperType = () => {
    if (!newPaperTypeForm.name.trim()) return;
    const newId = `pt_${Date.now()}`;
    const newPt: PaperType = { id: newId, name: newPaperTypeForm.name.trim(), nameAr: newPaperTypeForm.nameAr.trim() || newPaperTypeForm.name.trim(), colorPerPage: newPaperTypeForm.colorPerPage, blackWhitePerPage: newPaperTypeForm.blackWhitePerPage };
    setPaperTypes(prev => [...prev, newPt]);
    setShowAddPaperTypeForm(false);
    setNewPaperTypeForm({ name: "", nameAr: "", colorPerPage: 30, blackWhitePerPage: 15 });
    toast({ title: isRtl ? "تم إضافة نوع الورق. لا تنس حفظ الإعدادات!" : "Paper type added. Don't forget to save settings!", variant: "success" });
  };

  const handleSavePaperType = (id: string) => {
    if (!editingPaperTypeForm) return;
    setPaperTypes(prev => prev.map(pt => pt.id === id ? { ...pt, ...editingPaperTypeForm } : pt));
    setEditingPaperTypeId(null);
    setEditingPaperTypeForm(null);
  };

  const handleDeletePaperType = (id: string) => {
    setPaperTypes(prev => prev.filter(pt => pt.id !== id));
  };

  const saveSettings = async () => {
    await storageService.saveSettings({ shopName, paperTypes });
    onSettingsUpdate({ ...currentSettings, shopName, paperTypes });
    toast({ title: isRtl ? "تم الحفظ بنجاح" : "Settings saved successfully", variant: "success" });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const newLogoUrl = await storageService.uploadLogo(file);
        setLogoUrl(newLogoUrl);
        onSettingsUpdate({ ...currentSettings, logoUrl: newLogoUrl });
        toast({ title: isRtl ? "تم رفع الشعار بنجاح" : "Logo uploaded successfully", variant: "success" });
      } catch (err) {
        toast({ title: isRtl ? "فشل رفع الشعار" : "Failed to upload logo", variant: "destructive" });
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

  const isOfficeFile = (fileType: string) => {
    return (
      fileType.includes("wordprocessingml.document") ||
      fileType.includes("msword") ||
      fileType.includes("spreadsheetml.sheet") ||
      fileType.includes("ms-excel") ||
      fileType.includes("presentationml.presentation") ||
      fileType.includes("ms-powerpoint")
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
            <Button variant="ghost" size="sm" onClick={handleBulkPrint} title={t("bulkPrint")} className="flex-col gap-1 h-auto text-inherit hover:text-indigo-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
              <span className="text-[10px] hidden sm:block uppercase tracking-wider font-bold">{t("print")}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleBulkDownload} title={t("bulkDownload")} className="flex-col gap-1 h-auto text-inherit hover:text-indigo-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
              <span className="text-[10px] hidden sm:block uppercase tracking-wider font-bold">{t("download")}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleBulkStatusUpdate} title={t("markAsPrinted")} className="flex-col gap-1 h-auto text-inherit hover:text-green-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              <span className="text-[10px] hidden sm:block uppercase tracking-wider font-bold">{t("printed")}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleBulkDelete} title={t("bulkDelete")} className="flex-col gap-1 h-auto text-inherit hover:text-red-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
              <span className="text-[10px] hidden sm:block uppercase tracking-wider font-bold">{t("delete")}</span>
            </Button>
          </div>

          <Button variant="ghost" size="icon" onClick={() => setSelectedJobIds(new Set())} className="ml-4 text-white hover:bg-white/10">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </Button>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("dashboard")}</h1>
          <p className="text-sm text-gray-500">
            {isRtl
              ? "إدارة المحل وطلبات الطباعة"
              : "Manage your shop and print requests"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => (window.location.hash = "")}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
            {isRtl ? "صفحة الرفع" : "Upload Page"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
            {t("logout")}
          </Button>
        </div>
      </div>

      <div className="flex border-b border-gray-100 mb-5 gap-1">
        <Button
          variant={activeTab === "jobs" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("jobs")}
        >
          {t("jobs")}
        </Button>
        <Button
          variant={activeTab === "settings" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("settings")}
        >
          {t("settings")}
        </Button>
      </div>

      <div className="min-h-[400px]">
        {activeTab === "jobs" ? (
          <>
            {/* Stats Summary Bar */}
            {!loading && groups.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-yellow-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{isRtl ? "قيد الانتظار" : "Pending"}</div>
                    <div className="text-xl font-bold text-yellow-600">{groups.reduce((acc, g) => acc + g.jobs.filter(j => j.status === PrintStatus.PENDING).length, 0)}</div>
                  </div>
                </div>
                <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{isRtl ? "جاهز للاستلام" : "Ready"}</div>
                    <div className="text-xl font-bold text-blue-600">{groups.reduce((acc, g) => acc + g.jobs.filter(j => j.status === PrintStatus.READY).length, 0)}</div>
                  </div>
                </div>
                <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{isRtl ? "تمت الطباعة" : "Printed"}</div>
                    <div className="text-xl font-bold text-green-600">{groups.reduce((acc, g) => acc + g.jobs.filter(j => j.status === PrintStatus.PRINTED).length, 0)}</div>
                  </div>
                </div>
                <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{isRtl ? "إجمالي العملاء" : "Customers"}</div>
                    <div className="text-xl font-bold text-indigo-600">{groups.length}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Search Bar */}
            {!loading && groups.length > 0 && (
              <div className="relative mb-4">
                <div className={`absolute ${isRtl ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 text-gray-400`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                </div>
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={isRtl ? "ابحث بالاسم أو رقم الهاتف..." : "Search by name or phone..."}
                  className={`${isRtl ? "pr-9 pl-4" : "pl-9 pr-4"}`}
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSearchQuery("")}
                    className={`absolute ${isRtl ? "left-1" : "right-1"} top-1/2 -translate-y-1/2 h-7 w-7`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                  </Button>
                )}
              </div>
            )}

            {(() => {
              const filteredGroups = searchQuery.trim()
                ? groups.filter(
                    (g) =>
                      g.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      g.phoneNumber.includes(searchQuery)
                  )
                : groups;
              return (
            <>
            {loading ? (
              <div className="p-12 text-center text-gray-500">
                Loading from server...
              </div>
            ) : groups.length === 0 ? (
              <div className="p-12 text-center text-gray-500 bg-white rounded-2xl border border-gray-200">
                <p>{t("noJobs")}</p>
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="p-8 text-center text-gray-500 bg-white rounded-2xl border border-gray-200">
                <svg className="w-10 h-10 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                <p>{isRtl ? "لا توجد نتائج" : "No results found"}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredGroups.map((group) => {
                  const isCollapsed = collapsedGroups.has(group.key);
                  const isExpanded = !isCollapsed;
                  const pendingCount = group.jobs.filter(
                    (j) => j.status === PrintStatus.PENDING || j.status === PrintStatus.READY,
                  ).length;
                  const allInGroupSelected = group.jobs.every((id) =>
                    selectedJobIds.has(id.id),
                  );
                  const customerTotalData = currentSettings.pricing
                    ? calculateCustomerTotalWithDiscounts(
                        group.jobs,
                        currentSettings,
                        jobPageCounts,
                        discountRules,
                      )
                    : null;
                  const customerTotal = customerTotalData?.finalTotal || 0;
                  const customerDiscount = customerTotalData?.totalDiscount || 0;

                  return (
                    <div
                      key={group.key}
                      className="bg-white rounded-2xl shadow-md shadow-indigo-100/40 border border-white overflow-hidden mb-3 transition-all"
                    >
                      <div className="flex items-center border-b border-gray-50 bg-white group/header">
                        <div className="px-4 py-2.5 flex items-center">
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            checked={
                              allInGroupSelected && group.jobs.length > 0
                            }
                            onChange={(e) => toggleSelectGroup(group.jobs, e)}
                          />
                        </div>
                        <button
                          onClick={() => toggleGroup(group.key)}
                          className="flex-1 px-2 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div
                              className={`w-8 h-8 rounded-full flex items-center justify-center ${
                                pendingCount > 0
                                  ? "bg-indigo-100 text-indigo-600"
                                  : "bg-gray-100 text-gray-400"
                              }`}
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
                                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                                ></path>
                              </svg>
                            </div>
                            <div className="truncate text-left">
                              <h3 className="text-sm font-bold text-gray-900 truncate">
                                {group.customerName ||
                                  (isRtl ? "بدون اسم" : "No Name")}
                              </h3>
                              <p className="text-xs text-gray-500">
                                {group.phoneNumber ||
                                  (isRtl ? "بدون هاتف" : "No Phone")}
                                {" · "}
                                <span className="text-gray-400">{formatRelativeTime(group.latestDate, lang)}</span>
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 pr-4">
                            {customerTotal > 0 && (
                              <div className="flex flex-col items-end">
                                {customerDiscount > 0 && (
                                  <span className="text-xs text-gray-400 line-through">
                                    {formatPrice(customerTotal + customerDiscount)}
                                  </span>
                                )}
                                <span className="text-sm font-bold text-green-700 bg-green-100/50 px-3 py-1 rounded-full border border-green-200/50 shadow-sm whitespace-nowrap">
                                  {formatPrice(customerTotal)}
                                </span>
                                {customerDiscount > 0 && (
                                  <span className="text-xs text-green-600 mt-0.5">
                                    {isRtl ? "تم توفير" : "Saved"} {formatPrice(customerDiscount)}
                                  </span>
                                )}
                              </div>
                            )}
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
                        <div className="bg-gray-50/30 overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead className="bg-[#F8FAFC] border-b border-gray-100">
                              <tr>
                                <th className="px-4 py-2 w-10">
                                  <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
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
                                  className={`px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider ${isRtl ? "text-right" : ""}`}
                                >
                                  {t("fileName")}
                                </th>
                                <th
                                  className={`px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider ${isRtl ? "text-right" : ""}`}
                                >
                                  {isRtl ? "الإعدادات" : "Settings"}
                                </th>
                                <th
                                  className={`px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider ${isRtl ? "text-right" : ""}`}
                                >
                                  {isRtl ? "التكلفة" : "Cost"}
                                </th>
                                <th
                                  className={`px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider ${isRtl ? "text-right" : ""}`}
                                >
                                  {t("status")}
                                </th>
                                <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                  {t("actions")}
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {group.jobs.map((job) => {
                                const isSelected = selectedJobIds.has(job.id);
                                const ext = getFileExtension(job.fileName);
                                const officeFile = isOfficeFile(job.fileType);

                                return (
                                  <tr
                                    key={job.id}
                                    className={`group/row transition-all duration-200 border-b border-gray-50 last:border-0 ${
                                      isSelected
                                        ? "bg-indigo-50/60"
                                        : "hover:bg-white"
                                    }`}
                                  >
                                    <td className="px-4 py-2">
                                      <input
                                        type="checkbox"
                                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                        checked={isSelected}
                                        onChange={() => toggleSelectJob(job.id)}
                                      />
                                    </td>
                                    <td className="px-4 py-2">
                                      <div className="flex items-center gap-3 w-max">
                                        <span
                                          className={`text-[10px] font-bold px-2 py-1 rounded-md border flex-shrink-0 ${
                                            ext === "PDF"
                                              ? "bg-red-50 text-red-600 border-red-100"
                                              : ext === "DOCX" || ext === "DOC"
                                                ? "bg-blue-50 text-blue-600 border-blue-100"
                                                : officeFile
                                                  ? "bg-green-50 text-green-700 border-green-200"
                                                  : "bg-indigo-50 text-indigo-600 border-indigo-100"
                                          }`}
                                        >
                                          {ext}
                                        </span>
                                        <div className="flex flex-col">
                                          <span
                                            className="text-sm font-semibold text-gray-900 max-w-[200px] truncate"
                                            title={job.fileName}
                                          >
                                            {job.fileName}
                                          </span>
                                          <span className="text-xs text-gray-400">
                                            {formatSize(job.fileSize)}
                                          </span>
                                        </div>
                                      </div>
                                      {job.notes && (
                                        <div className="text-[11px] text-indigo-600 bg-indigo-50/50 px-2 py-1 rounded-md inline-block mt-2 font-medium">
                                          {job.notes}
                                        </div>
                                      )}
                                    </td>

                                    {/* Settings Cell (Color & Copies) */}
                                    <td className="px-4 py-2 align-top">
                                      {job.printPreferences && (
                                        <div className="flex flex-col gap-2 w-max">
                                          <Button
                                            type="button"
                                            title={isRtl ? "انقر للتبديل" : "Toggle mode"}
                                            disabled={savingPrefsJobId === job.id}
                                            onClick={() => handleToggleColorMode(job)}
                                            variant={job.printPreferences.colorMode === "blackWhite" ? "secondary" : "default"}
                                            size="sm"
                                            className="text-xs h-7 px-2"
                                          >
                                            {savingPrefsJobId === job.id ? (
                                              <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                                            ) : (
                                              <>
                                                <span className="text-[10px]">{job.printPreferences.colorMode === "blackWhite" ? "⚫" : "🎨"}</span>
                                                {job.printPreferences.colorMode === "blackWhite" ? (isRtl ? "أبيض وأسود" : "B&W") : (isRtl ? "ملون" : "Color")}
                                              </>
                                            )}
                                          </Button>

                                          {/* Copies Stepper */}
                                          {editingCopiesJobId === job.id ? (
                                            <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-0.5 shadow-sm w-max">
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="w-6 h-6"
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() => setEditingCopiesValue((v) => Math.max(1, v - 1))}
                                              >−</Button>
                                              <Input
                                                type="number"
                                                min={1}
                                                max={100}
                                                autoFocus
                                                value={editingCopiesValue}
                                                onChange={(e) => setEditingCopiesValue(parseInt(e.target.value) || 1)}
                                                onKeyDown={(e) => {
                                                  if (e.key === "Enter") handleSaveCopies(job, editingCopiesValue);
                                                  if (e.key === "Escape") setEditingCopiesJobId(null);
                                                }}
                                                onBlur={() => handleSaveCopies(job, editingCopiesValue)}
                                                className="w-10 text-center text-xs font-semibold h-7 px-0"
                                              />
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="w-6 h-6"
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() => setEditingCopiesValue((v) => Math.min(100, v + 1))}
                                              >+</Button>
                                              <Button
                                                type="button"
                                                size="icon"
                                                className="w-6 h-6 ml-1"
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() => handleSaveCopies(job, editingCopiesValue)}
                                              >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                                              </Button>
                                            </div>
                                          ) : (
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              className="text-xs h-7"
                                              onClick={() => {
                                                setEditingCopiesJobId(job.id);
                                                setEditingCopiesValue(job.printPreferences?.copies || 1);
                                              }}
                                            >
                                              ×{job.printPreferences?.copies || 1} {isRtl ? "نسخ" : "copies"}
                                            </Button>
                                          )}

                                          {/* Paper Type Badge */}
                                          {job.printPreferences?.paperType && (
                                            <span className="text-xs px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg font-medium w-max">
                                              {getPaperTypeName(job.printPreferences.paperType)}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </td>

                                    {/* Cost Cell */}
                                    <td className="px-4 py-2 align-top w-max">
                                      {(currentSettings.pricing || (currentSettings.paperTypes && currentSettings.paperTypes.length > 0)) ? (
                                        (() => {
                                          const pageCount = jobPageCounts[job.id] || 1;
                                          const priceCalc = calculatePrintPrice(job, currentSettings, pageCount);
                                          const discountResult = calculateJobDiscount(job, priceCalc.totalPrice, pageCount, discountRules);
                                          const hasDiscount = discountResult.discountAmount > 0;

                                          return (
                                            <div className="flex flex-col gap-2">
                                              <div className="flex flex-col">
                                                {hasDiscount && (
                                                  <span className="text-xs text-gray-400 line-through">
                                                    {formatPrice(discountResult.originalAmount)}
                                                  </span>
                                                )}
                                                <span className={`text-sm font-black bg-green-100/50 px-2.5 py-1 rounded-md border border-green-200/50 shadow-sm w-max inline-block tracking-tight ${hasDiscount ? "text-green-700" : "text-green-700"}`}>
                                                  {formatPrice(discountResult.finalAmount)}
                                                </span>
                                                {hasDiscount && discountResult.rule && (
                                                  <span className="text-xs text-green-600 mt-0.5">
                                                    {isRtl ? "تم تطبيق خصم" : "Discount applied"}: {discountResult.rule.name}
                                                  </span>
                                                )}
                                              </div>
                                              <div className="flex items-center gap-1.5 text-xs text-gray-500 font-medium w-max">
                                                <span>
                                                  {isRtl ? "الصفحات:" : "Pages:"}
                                                </span>
                                                <span className="font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)] text-[11px]">
                                                  {pageCount}
                                                </span>
                                              </div>
                                            </div>
                                          );
                                        })()
                                      ) : (
                                        <span className="text-xs text-gray-400">
                                          -
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-4 py-2 align-top">
                                      <span
                                        className={`px-3 py-1 text-[11px] font-bold rounded-full uppercase tracking-wide inline-block ${
                                          job.status === PrintStatus.PRINTED
                                            ? "bg-green-100 text-green-700"
                                            : job.status === PrintStatus.READY
                                            ? "bg-blue-100 text-blue-700"
                                            : "bg-yellow-100 text-yellow-700"
                                        }`}
                                      >
                                        {job.status === PrintStatus.PRINTED
                                          ? t("printed")
                                          : job.status === PrintStatus.READY
                                          ? t("ready")
                                          : t("pending")}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2 align-top">
                                      <div className="flex flex-wrap gap-1 w-max">
                                        {!officeFile && (
                                          <Button variant="ghost" size="icon" onClick={() => handlePrint(job)} title={t("print")} className="text-blue-600 hover:bg-blue-100 hover:text-blue-700">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                                          </Button>
                                        )}
                                        <Button variant="ghost" size="icon" onClick={() => handleEdit(job)} title={t("edit")} className="text-orange-600 hover:bg-orange-100 hover:text-orange-700">
                                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => handleDownload(job)} title={t("download")} className="text-indigo-600 hover:bg-indigo-100 hover:text-indigo-700">
                                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                        </Button>
                                        <Select value={job.status} onValueChange={(val) => handleStatusChange(job.id, val as PrintStatus)}>
                                          <SelectTrigger className={`h-8 w-9 border-0 p-0 ${job.status === PrintStatus.PRINTED ? "text-green-600 hover:bg-green-100" : job.status === PrintStatus.READY ? "text-blue-600 hover:bg-blue-100" : "text-yellow-600 hover:bg-yellow-100"}`}>
                                            <SelectValue>
                                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                            </SelectValue>
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value={PrintStatus.PENDING}>
                                              <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block"></span>{isRtl ? "قيد الانتظار" : "Pending"}</span>
                                            </SelectItem>
                                            <SelectItem value={PrintStatus.READY}>
                                              <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>{isRtl ? "جاهز" : "Ready"}</span>
                                            </SelectItem>
                                            <SelectItem value={PrintStatus.PRINTED}>
                                              <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>{isRtl ? "تمت الطباعة" : "Printed"}</span>
                                            </SelectItem>
                                          </SelectContent>
                                        </Select>
                                        <Button variant="ghost" size="icon" onClick={() => handleDelete(job.id)} title={t("delete")} className="text-red-600 hover:bg-red-100 hover:text-red-700">
                                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                        </Button>
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
            );
            })()}
          </>
        ) : (
          <div className="max-w-5xl mx-auto">
            {/* Page Header */}
            <div className="mb-8">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">
                {isRtl ? "إعدادات المحل" : "Shop Settings"}
              </h2>
              <p className="text-gray-600 mt-1 text-sm sm:text-base">
                {isRtl
                  ? "إدارة إعدادات المحل والتسعير"
                  : "Manage your shop configuration and pricing"}
              </p>
            </div>

            {/* Settings Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              {/* Shop Info Card */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </div>
                    <div>
                      <CardTitle className="text-base">{isRtl ? "معلومات المحل" : "Shop Information"}</CardTitle>
                      <CardDescription>{isRtl ? "الاسم والشعار" : "Name & logo"}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">{t("shopName")}</label>
                    <Input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder={isRtl ? "اسم المحل" : "Print Shop Name"} />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">{t("shopLogo")}</label>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                      {logoUrl ? (
                        <div className="w-20 h-20 rounded-xl border-2 border-white shadow-md overflow-hidden bg-gray-100 flex-shrink-0">
                          <img src={logoUrl} alt="Logo Preview" className="w-full h-full object-contain" />
                        </div>
                      ) : (
                        <div className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex items-center justify-center flex-shrink-0">
                          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                      <div className="flex-1 w-full">
                        <Input type="file" accept="image/*" onChange={handleLogoUpload} className="file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-600 hover:file:bg-indigo-100 file:cursor-pointer cursor-pointer" />
                        <p className="text-xs text-gray-400 mt-2">{isRtl ? "PNG, JPG أو GIF (الحد الأقصى 2MB)" : "PNG, JPG or GIF (max 2MB)"}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Pricing Card */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-green-100 text-green-600 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <CardTitle className="text-base">{isRtl ? "أسعار الطباعة" : "Printing Prices"}</CardTitle>
                      <CardDescription>{isRtl ? "التسعير لكل صفحة" : "Per page pricing"}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-gray-700">
                      {isRtl ? "أنواع الورق وأسعارها" : "Paper Types & Pricing"}
                    </label>
                    <Button size="sm" onClick={() => { setShowAddPaperTypeForm(true); setEditingPaperTypeId(null); }}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                      {isRtl ? "إضافة نوع" : "Add Type"}
                    </Button>
                  </div>

                  <div className="overflow-x-auto border border-gray-100 rounded-xl">
                    <table className="w-full text-sm min-w-[400px]">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className={`px-3 py-2.5 text-xs font-semibold text-gray-500 ${isRtl ? "text-right" : "text-left"}`}>{isRtl ? "نوع الورق" : "Paper Type"}</th>
                          <th className={`px-3 py-2.5 text-xs font-semibold text-gray-500 ${isRtl ? "text-right" : "text-left"}`}>{isRtl ? "ملون" : "Color"}</th>
                          <th className={`px-3 py-2.5 text-xs font-semibold text-gray-500 ${isRtl ? "text-right" : "text-left"}`}>{isRtl ? "أبيض/أسود" : "B&W"}</th>
                          <th className="px-3 py-2.5 w-16"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {paperTypes.map((pt, idx) => (
                          <tr key={pt.id} className={idx < paperTypes.length - 1 ? "border-b border-gray-100" : ""}>
                            {editingPaperTypeId === pt.id && editingPaperTypeForm ? (
                              <>
                                <td className="px-3 py-2">
                                  <Input value={editingPaperTypeForm.name} onChange={e => setEditingPaperTypeForm({ ...editingPaperTypeForm, name: e.target.value })} placeholder="EN" className="text-xs mb-1 h-7" />
                                  <Input value={editingPaperTypeForm.nameAr} onChange={e => setEditingPaperTypeForm({ ...editingPaperTypeForm, nameAr: e.target.value })} placeholder="AR" className="text-xs h-7" />
                                </td>
                                <td className="px-3 py-2">
                                  <Input type="number" min="0" step="0.5" value={editingPaperTypeForm.colorPerPage} onChange={e => setEditingPaperTypeForm({ ...editingPaperTypeForm, colorPerPage: parseFloat(e.target.value) || 0 })} className="w-20 text-xs h-7" />
                                </td>
                                <td className="px-3 py-2">
                                  <Input type="number" min="0" step="0.5" value={editingPaperTypeForm.blackWhitePerPage} onChange={e => setEditingPaperTypeForm({ ...editingPaperTypeForm, blackWhitePerPage: parseFloat(e.target.value) || 0 })} className="w-20 text-xs h-7" />
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex gap-1">
                                    <Button size="sm" variant="default" onClick={() => handleSavePaperType(pt.id)}>✓</Button>
                                    <Button size="sm" variant="outline" onClick={() => { setEditingPaperTypeId(null); setEditingPaperTypeForm(null); }}>✕</Button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-3 py-3">
                                  <div className="font-semibold text-gray-900 text-sm">{isRtl ? pt.nameAr : pt.name}</div>
                                  <div className="text-xs text-gray-400">{isRtl ? pt.name : pt.nameAr}</div>
                                </td>
                                <td className="px-3 py-3">
                                  <span className="font-semibold text-indigo-700">{pt.colorPerPage}</span>
                                  <span className="text-xs text-gray-400 ml-1">DZD</span>
                                </td>
                                <td className="px-3 py-3">
                                  <span className="font-semibold text-gray-700">{pt.blackWhitePerPage}</span>
                                  <span className="text-xs text-gray-400 ml-1">DZD</span>
                                </td>
                                <td className="px-3 py-3">
                                  <div className="flex gap-1">
                                    <Button variant="ghost" size="icon" onClick={() => { setEditingPaperTypeId(pt.id); setEditingPaperTypeForm({ name: pt.name, nameAr: pt.nameAr, colorPerPage: pt.colorPerPage, blackWhitePerPage: pt.blackWhitePerPage }); setShowAddPaperTypeForm(false); }} title="Edit">
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536M9 11l6.071-6.071a2.5 2.5 0 113.536 3.536L12.536 14.5a2 2 0 01-.93.534l-3.192.798.798-3.192a2 2 0 01.534-.93L9 11z"/></svg>
                                    </Button>
                                    {paperTypes.length > 1 && (
                                      <Button variant="ghost" size="icon" onClick={() => handleDeletePaperType(pt.id)} title="Delete">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                      </Button>
                                    )}
                                  </div>
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Add Paper Type Dialog */}
                  <Dialog open={showAddPaperTypeForm} onOpenChange={(open) => { if (!open) { setShowAddPaperTypeForm(false); setNewPaperTypeForm({ name: "", nameAr: "", colorPerPage: 30, blackWhitePerPage: 15 }); }}}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{isRtl ? "إضافة نوع ورق جديد" : "Add New Paper Type"}</DialogTitle>
                      </DialogHeader>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1.5">{isRtl ? "الاسم (EN)" : "Name (EN)"}</label>
                          <Input
                            value={newPaperTypeForm.name}
                            onChange={e => setNewPaperTypeForm({ ...newPaperTypeForm, name: e.target.value })}
                            placeholder="e.g. Matte"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1.5">{isRtl ? "الاسم (AR)" : "Name (AR)"}</label>
                          <Input
                            value={newPaperTypeForm.nameAr}
                            onChange={e => setNewPaperTypeForm({ ...newPaperTypeForm, nameAr: e.target.value })}
                            placeholder="مثلاً: مطفي"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1.5">{isRtl ? "سعر ملون (DZD)" : "Color (DZD)"}</label>
                          <Input
                            type="number"
                            min="0"
                            step="0.5"
                            value={newPaperTypeForm.colorPerPage}
                            onChange={e => setNewPaperTypeForm({ ...newPaperTypeForm, colorPerPage: parseFloat(e.target.value) || 0 })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1.5">{isRtl ? "سعر أبيض/أسود (DZD)" : "B&W (DZD)"}</label>
                          <Input
                            type="number"
                            min="0"
                            step="0.5"
                            value={newPaperTypeForm.blackWhitePerPage}
                            onChange={e => setNewPaperTypeForm({ ...newPaperTypeForm, blackWhitePerPage: parseFloat(e.target.value) || 0 })}
                          />
                        </div>
                      </div>
                      <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => { setShowAddPaperTypeForm(false); setNewPaperTypeForm({ name: "", nameAr: "", colorPerPage: 30, blackWhitePerPage: 15 }); }}>
                          {isRtl ? "إلغاء" : "Cancel"}
                        </Button>
                        <Button onClick={handleAddPaperType}>
                          {isRtl ? "إضافة" : "Add"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            </div>

            {/* Password Change Card */}
            <Card className="lg:col-span-2">
              <CardHeader className="flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                  </div>
                  <div>
                    <CardTitle className="text-base">{isRtl ? "تغيير كلمة المرور" : "Change Password"}</CardTitle>
                    <CardDescription>{isRtl ? "تحديث كلمة مرور المسؤول" : "Update admin password"}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <form onSubmit={handleChangePassword} className="p-5 sm:p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">{isRtl ? "كلمة المرور الحالية" : "Current Password"}</label>
                    <div className="relative">
                      <Input type={showPasswords.current ? "text" : "password"} value={passwordForm.current} onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })} placeholder="••••••••" required className="pr-10" />
                      <Button type="button" variant="ghost" size="icon" onClick={() => setShowPasswords(p => ({ ...p, current: !p.current }))} className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" tabIndex={-1}>
                        {showPasswords.current ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">{isRtl ? "كلمة المرور الجديدة" : "New Password"}</label>
                    <div className="relative">
                      <Input type={showPasswords.newPass ? "text" : "password"} value={passwordForm.newPass} onChange={(e) => setPasswordForm({ ...passwordForm, newPass: e.target.value })} placeholder="••••••••" required className="pr-10" />
                      <Button type="button" variant="ghost" size="icon" onClick={() => setShowPasswords(p => ({ ...p, newPass: !p.newPass }))} className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" tabIndex={-1}>
                        {showPasswords.newPass ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">{isRtl ? "تأكيد كلمة المرور" : "Confirm Password"}</label>
                    <div className="relative">
                      <Input type={showPasswords.confirm ? "text" : "password"} value={passwordForm.confirm} onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })} placeholder="••••••••" required className="pr-10" />
                      <Button type="button" variant="ghost" size="icon" onClick={() => setShowPasswords(p => ({ ...p, confirm: !p.confirm }))} className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" tabIndex={-1}>
                        {showPasswords.confirm ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>}
                      </Button>
                    </div>
                  </div>
                </div>
                {passwordError && <p className="text-sm text-red-600 font-medium">{passwordError}</p>}
                {passwordSuccess && <p className="text-sm text-green-600 font-medium">{isRtl ? "✓ تم تغيير كلمة المرور بنجاح" : "✓ Password changed successfully"}</p>}
                <Button type="submit" variant="destructive">{isRtl ? "تغيير كلمة المرور" : "Change Password"}</Button>
              </form>
            </Card>

            {/* Discount Rules Card - Full Width */}
            <Card className="lg:col-span-2">
              <CardHeader className="flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                  </div>
                  <div>
                    <CardTitle className="text-base">{isRtl ? "قواعد الخصم" : "Discount Rules"}</CardTitle>
                    <CardDescription>{isRtl ? "خصومات تلقائية للطباعة بالجملة" : "Automatic bulk print discounts"}</CardDescription>
                  </div>
                </div>
                <Button size="sm" onClick={handleAddRule}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                  {isRtl ? "إضافة قاعدة" : "Add Rule"}
                </Button>
              </CardHeader>

              <CardContent>
                {discountRules.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>{isRtl ? "لا توجد قواعد خصم بعد" : "No discount rules yet"}</p>
                    <p className="text-sm mt-1">
                      {isRtl ? "انقر على إضافة قاعدة لإنشاء خصم جديد" : "Click Add Rule to create a discount"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {discountRules.map((rule) => (
                      <div
                        key={rule.id}
                        className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                          rule.is_active
                            ? "bg-white border-gray-200"
                            : "bg-gray-50 border-gray-100 opacity-60"
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          {/* Active Toggle */}
                          <button
                            type="button"
                            onClick={() => handleToggleRuleActive(rule)}
                            className={`relative w-12 h-6 rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-purple-500/40 ${
                              rule.is_active ? "bg-purple-600" : "bg-gray-300"
                            }`}
                          >
                            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300 ${
                              isRtl
                                ? (rule.is_active ? "right-[1.625rem]" : "right-0.5")
                                : (rule.is_active ? "left-[1.625rem]" : "left-0.5")
                            }`} />
                          </button>

                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-gray-900">{rule.name}</span>
                              {rule.priority > 0 && (
                                <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full font-medium">
                                  P{rule.priority}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-500 mt-0.5">
                              {rule.discount_type === "percent"
                                ? `${rule.discount_value}% ${isRtl ? "خصم" : "off"}`
                                : `${rule.discount_value} DZD ${isRtl ? "خصم" : "off"}`}
                              {" · "}
                              {rule.condition_type === "pages"
                                ? `${isRtl ? "عند" : "when"} ≥ ${rule.threshold} ${isRtl ? "صفحة" : "pages"}`
                                : `${isRtl ? "عند" : "when"} ≥ ${rule.threshold} DZD`}
                              {rule.max_discount_cap && ` ${isRtl ? "(حد أقصى" : "(max"} ${rule.max_discount_cap} DZD)`}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEditRule(rule)}>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteRule(rule.id)}>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-4 sm:mt-6">
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                <div className="text-xs text-gray-500 mb-1">
                  {isRtl ? "الملفات المعلقة" : "Pending Files"}
                </div>
                <div className="text-xl sm:text-2xl font-bold text-yellow-600">
                  {groups.reduce((acc, g) => acc + g.jobs.filter(j => j.status === PrintStatus.PENDING).length, 0)}
                </div>
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                <div className="text-xs text-gray-500 mb-1">
                  {isRtl ? "جاهز للاستلام" : "Ready Files"}
                </div>
                <div className="text-xl sm:text-2xl font-bold text-blue-600">
                  {groups.reduce((acc, g) => acc + g.jobs.filter(j => j.status === PrintStatus.READY).length, 0)}
                </div>
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                <div className="text-xs text-gray-500 mb-1">
                  {isRtl ? "الملفات المطبوعة" : "Printed Files"}
                </div>
                <div className="text-xl sm:text-2xl font-bold text-green-600">
                  {groups.reduce((acc, g) => acc + g.jobs.filter(j => j.status === PrintStatus.PRINTED).length, 0)}
                </div>
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                <div className="text-xs text-gray-500 mb-1">
                  {isRtl ? "إجمالي العملاء" : "Total Customers"}
                </div>
                <div className="text-xl sm:text-2xl font-bold text-indigo-600">
                  {groups.length}
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
              <p className="text-sm text-gray-500">
                {isRtl
                  ? "سيتم حفظ التغييرات فورًا"
                  : "Changes will be saved immediately"}
              </p>
              <Button onClick={saveSettings} className="shadow-lg">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
                {t("saveSettings")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={bulkDeleteConfirm} onOpenChange={setBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isRtl ? "حذف متعدد" : "Bulk Delete"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isRtl ? `هل أنت متأكد من حذف ${selectedJobIds.size} ملف؟` : `Are you sure you want to delete ${selectedJobIds.size} files?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isRtl ? "إلغاء" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{isRtl ? "حذف" : "Delete"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Single Delete Confirmation */}
      <AlertDialog open={singleDeleteConfirm !== null} onOpenChange={(open) => { if (!open) setSingleDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isRtl ? "تأكيد الحذف" : "Confirm Delete"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isRtl ? "هل أنت متأكد من حذف هذا الملف؟" : "Are you sure you want to delete this file?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isRtl ? "إلغاء" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSingleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{isRtl ? "حذف" : "Delete"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Rule Confirmation */}
      <AlertDialog open={deleteRuleConfirm !== null} onOpenChange={(open) => { if (!open) setDeleteRuleConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isRtl ? "تأكيد حذف القاعدة" : "Delete Rule Confirmation"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isRtl ? "هل أنت متأكد من حذف قاعدة الخصم هذه؟ لا يمكن التراجع عن هذا الإجراء." : "Are you sure you want to delete this discount rule? This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isRtl ? "إلغاء" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteRule} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{isRtl ? "حذف" : "Delete"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Toaster */}
      <Toaster />

{/* Rule Form Dialog */}
<Dialog open={showRuleForm} onOpenChange={setShowRuleForm}>
  <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>
        {isEditingRule
          ? (isRtl ? "تعديل قاعدة الخصم" : "Edit Discount Rule")
          : (isRtl ? "إضافة قاعدة خصم" : "Add Discount Rule")}
      </DialogTitle>
    </DialogHeader>

    <div className="space-y-5">
      {/* Rule Name */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          {isRtl ? "اسم القاعدة" : "Rule Name"} *
        </label>
        <Input
          value={ruleFormData.name || ""}
          onChange={(e) => setRuleFormData({ ...ruleFormData, name: e.target.value })}
          placeholder={isRtl ? "مثال: خصم الطلبات الكبيرة" : "e.g., Bulk Order Discount"}
        />
      </div>

      {/* Discount Type */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          {isRtl ? "نوع الخصم" : "Discount Type"}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant={ruleFormData.discount_type === "percent" ? "default" : "outline"}
            onClick={() => setRuleFormData({ ...ruleFormData, discount_type: "percent" })}
          >
            {isRtl ? "نسبة مئوية (%)" : "Percentage (%)"}
          </Button>
          <Button
            type="button"
            variant={ruleFormData.discount_type === "fixed" ? "default" : "outline"}
            onClick={() => setRuleFormData({ ...ruleFormData, discount_type: "fixed" })}
          >
            {isRtl ? "مبلغ ثابت (DZD)" : "Fixed Amount (DZD)"}
          </Button>
        </div>
      </div>

      {/* Discount Value */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          {ruleFormData.discount_type === "percent"
            ? (isRtl ? "نسبة الخصم" : "Discount Percentage")
            : (isRtl ? "مبلغ الخصم" : "Discount Amount")}
        </label>
        <div className="relative">
          <Input
            type="number"
            min="0"
            step={ruleFormData.discount_type === "percent" ? "1" : "0.01"}
            value={ruleFormData.discount_value || ""}
            onChange={(e) => setRuleFormData({ ...ruleFormData, discount_value: parseFloat(e.target.value) })}
            placeholder={ruleFormData.discount_type === "percent" ? (isRtl ? "مثال: 10" : "e.g. 10") : (isRtl ? "مثال: 50" : "e.g. 50")}
            className={isRtl ? "pl-16 pr-4" : "pr-16 pl-4"}
          />
          <span className={`absolute ${isRtl ? "left-4" : "right-4"} top-1/2 -translate-y-1/2 text-gray-400 font-semibold pointer-events-none`}>
            {ruleFormData.discount_type === "percent" ? "%" : "DZD"}
          </span>
        </div>
      </div>

      {/* Condition Type */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          {isRtl ? "الشرط" : "Condition"}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant={ruleFormData.condition_type === "pages" ? "default" : "outline"}
            onClick={() => setRuleFormData({ ...ruleFormData, condition_type: "pages" })}
          >
            {isRtl ? "عدد الصفحات" : "Page Count"}
          </Button>
          <Button
            type="button"
            variant={ruleFormData.condition_type === "amount" ? "default" : "outline"}
            onClick={() => setRuleFormData({ ...ruleFormData, condition_type: "amount" })}
          >
            {isRtl ? "المبلغ الإجمالي" : "Total Amount"}
          </Button>
        </div>
      </div>

      {/* Threshold */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          {ruleFormData.condition_type === "pages"
            ? (isRtl ? "الحد الأدنى للصفحات" : "Minimum Pages")
            : (isRtl ? "الحد الأدنى للمبلغ" : "Minimum Amount")}
        </label>
        <div className="relative">
          <Input
            type="number"
            min="1"
            value={ruleFormData.threshold || ""}
            onChange={(e) => setRuleFormData({ ...ruleFormData, threshold: parseInt(e.target.value) })}
            className={isRtl ? "pl-20 pr-4" : "pr-20 pl-4"}
          />
          <span className={`absolute ${isRtl ? "left-4" : "right-4"} top-1/2 -translate-y-1/2 text-gray-400 font-semibold pointer-events-none`}>
            {ruleFormData.condition_type === "pages"
              ? (isRtl ? "صفحة" : "pages")
              : "DZD"}
          </span>
        </div>
      </div>

      {/* Max Cap (Optional) */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          {isRtl ? "الحد الأقصى للخصم (اختياري)" : "Max Discount Cap (Optional)"}
        </label>
        <div className="relative">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={ruleFormData.max_discount_cap || ""}
            onChange={(e) => setRuleFormData({ ...ruleFormData, max_discount_cap: e.target.value ? parseFloat(e.target.value) : null })}
            placeholder={isRtl ? "بدون حد أقصى" : "No cap"}
            className={isRtl ? "pl-16 pr-4" : "pr-16 pl-4"}
          />
          <span className={`absolute ${isRtl ? "left-4" : "right-4"} top-1/2 -translate-y-1/2 text-gray-400 font-semibold pointer-events-none`}>
            DZD
          </span>
        </div>
      </div>

      {/* Priority */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          {isRtl ? "الأولوية" : "Priority"}
        </label>
        <Input
          type="number"
          min="0"
          value={ruleFormData.priority || 0}
          onChange={(e) => setRuleFormData({ ...ruleFormData, priority: parseInt(e.target.value) || 0 })}
        />
        <p className="text-xs text-gray-400 mt-1">
          {isRtl ? "أرقام أعلى = أولوية أعلى" : "Higher numbers = higher priority"}
        </p>
      </div>
    </div>

    <DialogFooter className="gap-2">
      <Button variant="outline" onClick={() => setShowRuleForm(false)}>
        {isRtl ? "إلغاء" : "Cancel"}
      </Button>
      <Button onClick={handleSaveRule}>
        {isEditingRule
          ? (isRtl ? "حفظ التغييرات" : "Save Changes")
          : (isRtl ? "إنشاء القاعدة" : "Create Rule")}
      </Button>
    </DialogFooter>
    </DialogContent>
</Dialog>
    </div>
  );
};

export default AdminView;
