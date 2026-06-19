"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Plus, Pencil, Trash2, X, Upload, FileSpreadsheet, User } from "lucide-react";
import { Card } from "@/components/ui";
import {
  getEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  bulkUpsertEmployees,
  employeePhotoUrl,
  reloadEngineFaces,
  type ApiEmployee,
  type BulkEmployeeRow,
  type BulkResult,
} from "@/lib/api";
import { useFetch } from "@/lib/use-fetch";
import { cn } from "@/lib/utils";

const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Draft = {
  id: string;
  name: string;
  email: string;
  phone: string;
  photo: File | null;
};

const blank: Draft = { id: "", name: "", email: "", phone: "", photo: null };

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "mt-1 w-full rounded-lg border border-app bg-app px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition";

export default function EmployeesPage() {
  const { data, loading, error, reload } = useFetch<ApiEmployee[]>(getEmployees);
  const employees = data ?? [];

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  // Bulk import state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkEmployeeRow[] | null>(null);
  const [bulkPreview, setBulkPreview] = useState<{ valid: number; invalid: number } | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErr, setBulkErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const startAdd = () => {
    setDraft(blank);
    setEditingId(null);
    setFormErr(null);
    setOpen(true);
  };

  const startEdit = (e: ApiEmployee) => {
    setDraft({ id: String(e.id), name: e.name, email: e.email, phone: e.phone ?? "", photo: null });
    setEditingId(e.id);
    setFormErr(null);
    setOpen(true);
  };

  const validateDraft = (): string | null => {
    const idNum = Number(draft.id);
    if (!draft.id || !Number.isInteger(idNum) || idNum <= 0) return "Id must be a positive whole number.";
    if (!draft.name.trim()) return "Name is required.";
    if (!EMAIL_RX.test(draft.email.trim())) return "A valid email is required.";
    if (editingId === null && !draft.photo) return "A .jpg/.jpeg photo is required.";
    return null;
  };

  const save = async () => {
    const err = validateDraft();
    if (err) {
      setFormErr(err);
      return;
    }
    setSaving(true);
    setFormErr(null);
    try {
      if (editingId !== null) {
        await updateEmployee(editingId, {
          name: draft.name.trim(),
          email: draft.email.trim(),
          phone: draft.phone.trim() || undefined,
          photo: draft.photo,
        });
      } else {
        await createEmployee({
          id: Number(draft.id),
          name: draft.name.trim(),
          email: draft.email.trim(),
          phone: draft.phone.trim() || undefined,
          photo: draft.photo!,
        });
      }
      await reloadEngineFaces();
      setOpen(false);
      reload();
    } catch (e) {
      setFormErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (e: ApiEmployee) => {
    if (!confirm(`Delete ${e.name} (#${e.id})?`)) return;
    await deleteEmployee(e.id);
    await reloadEngineFaces();
    reload();
  };

  const onPhoto = (file: File | null) => {
    if (file) {
      const okType =
        file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);
      if (!okType) {
        setFormErr("Photo must be a .jpg or .jpeg file.");
        return;
      }
    }
    setFormErr(null);
    setDraft((d) => ({ ...d, photo: file }));
  };

  /* ------------------------- bulk import ------------------------- */

  const pickColumn = (headers: string[], ...keys: string[]) =>
    headers.findIndex((h) => keys.some((k) => h.includes(k)));

  const onBulkFile = async (file: File) => {
    setBulkErr(null);
    setBulkResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
      if (matrix.length < 2) {
        setBulkErr("The file has no data rows.");
        return;
      }
      const headers = (matrix[0] as unknown[]).map((h) => String(h ?? "").trim().toLowerCase());
      const iId = pickColumn(headers, "id");
      const iName = pickColumn(headers, "name");
      const iEmail = pickColumn(headers, "email", "mail");
      const iPhone = pickColumn(headers, "phone", "mobile", "contact");

      if (iId < 0 || iName < 0 || iEmail < 0) {
        setBulkErr("Could not find the required columns: id, name, email.");
        return;
      }

      const cell = (row: unknown[], idx: number) =>
        idx >= 0 && row[idx] != null ? String(row[idx]).trim() : "";

      const rows: BulkEmployeeRow[] = [];
      let valid = 0;
      let invalid = 0;
      for (let r = 1; r < matrix.length; r++) {
        const row = matrix[r] as unknown[];
        const idRaw = cell(row, iId);
        const name = cell(row, iName);
        const email = cell(row, iEmail);
        const phone = cell(row, iPhone);
        const idNum = Number(idRaw);
        const idOk = idRaw !== "" && Number.isInteger(idNum) && idNum > 0;
        const ok = idOk && name !== "" && EMAIL_RX.test(email);
        if (ok) valid++;
        else invalid++;
        rows.push({
          id: idOk ? idNum : null,
          name: name || null,
          email: email || null,
          phone: phone || null,
        });
      }

      setBulkRows(rows);
      setBulkPreview({ valid, invalid });
    } catch (e) {
      setBulkErr("Could not read the file. Use a .csv, .xlsx or .xls export. " + (e as Error).message);
    }
  };

  const runBulk = async () => {
    if (!bulkRows) return;
    setBulkBusy(true);
    setBulkErr(null);
    try {
      const result = await bulkUpsertEmployees(bulkRows);
      setBulkResult(result);
      await reloadEngineFaces();
      reload();
    } catch (e) {
      setBulkErr((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const resetBulk = () => {
    setBulkRows(null);
    setBulkPreview(null);
    setBulkResult(null);
    setBulkErr(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Employee Management</h1>
          <p className="text-muted text-sm mt-1">
            People the camera recognises. Add a photo so face recognition can identify them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              resetBulk();
              setBulkOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-app px-4 py-2 text-sm font-semibold text-main hover:bg-app transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4" /> Bulk Import
          </button>
          <button
            onClick={startAdd}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" /> Add Employee
          </button>
        </div>
      </div>

      {error && (
        <Card className="p-10 text-center text-muted">Couldn’t reach the API. Is the backend running?</Card>
      )}

      {!error && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-app">
                  <th className="font-medium px-4 py-3">Photo</th>
                  <th className="font-medium px-4 py-3">ID</th>
                  <th className="font-medium px-4 py-3">Name</th>
                  <th className="font-medium px-4 py-3">Email</th>
                  <th className="font-medium px-4 py-3">Phone</th>
                  <th className="font-medium px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {employees.map((e) => {
                  const photo = employeePhotoUrl(e);
                  return (
                    <tr key={e.id} className="hover:bg-app transition-colors">
                      <td className="px-4 py-3">
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photo} alt={e.name} className="w-10 h-10 rounded-full object-cover" />
                        ) : (
                          <div className="grid place-items-center w-10 h-10 rounded-full bg-app text-muted">
                            <User className="w-5 h-5" />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted">{e.id}</td>
                      <td className="px-4 py-3 font-medium">{e.name}</td>
                      <td className="px-4 py-3 text-muted">{e.email}</td>
                      <td className="px-4 py-3 text-muted tabular-nums">{e.phone || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => startEdit(e)} className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-brand/10 hover:text-brand transition-colors">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => remove(e)} className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-red-500/10 hover:text-red-500 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && employees.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-muted">No employees yet. Add one or bulk import.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Add / edit modal */}
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-lg p-6" >
            <div className="flex items-center justify-between mb-5" onClick={(e) => e.stopPropagation()}>
              <h2 className="font-semibold text-lg">{editingId !== null ? "Edit Employee" : "Add Employee"}</h2>
              <button onClick={() => setOpen(false)} className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-app">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" onClick={(e) => e.stopPropagation()}>
              <Field label="Employee ID" required>
                <input
                  type="number"
                  value={draft.id}
                  disabled={editingId !== null}
                  onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                  className={cn(inputCls, editingId !== null && "opacity-60 cursor-not-allowed")}
                  placeholder="e.g. 6"
                />
              </Field>
              <Field label="Name" required>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Email" required>
                <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={inputCls} placeholder="name@company.com" />
              </Field>
              <Field label="Phone">
                <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className={inputCls} placeholder="optional" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Photo (.jpg / .jpeg)" required={editingId === null}>
                  <input
                    type="file"
                    accept=".jpg,.jpeg,image/jpeg"
                    onChange={(e) => onPhoto(e.target.files?.[0] ?? null)}
                    className="mt-1 w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-2 file:text-white file:text-sm file:font-medium hover:file:opacity-90"
                  />
                </Field>
                <p className="mt-1 text-[11px] leading-snug text-muted">
                  {editingId !== null
                    ? "Leave empty to keep the current photo. A clear, front-facing headshot works best."
                    : "Use a clear, front-facing headshot with one face. Required for recognition."}
                </p>
              </div>
            </div>

            {formErr && <p className="mt-4 text-sm text-red-500">{formErr}</p>}

            <div className="flex justify-end gap-2 mt-6" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setOpen(false)} className="rounded-lg border border-app px-4 py-2 text-sm font-medium text-muted hover:bg-app">Cancel</button>
              <button onClick={save} disabled={saving} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Bulk import modal */}
      {bulkOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setBulkOpen(false)}>
          <Card className="w-full max-w-lg p-6" >
            <div className="flex items-center justify-between mb-1" onClick={(e) => e.stopPropagation()}>
              <h2 className="font-semibold text-lg">Bulk Import Employees</h2>
              <button onClick={() => setBulkOpen(false)} className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-app">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div onClick={(e) => e.stopPropagation()}>
              <p className="text-sm text-muted mb-4">
                Upload a <b>.csv</b>, <b>.xlsx</b> or <b>.xls</b> file with columns:{" "}
                <code className="text-main">id</code>, <code className="text-main">name</code>,{" "}
                <code className="text-main">email</code>, <code className="text-main">phone</code> (optional).
                Existing ids are updated; new ids are added. Rows missing or with invalid
                id/name/email are skipped. Photos are added later per employee.
              </p>

              {!bulkResult && (
                <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-app py-8 cursor-pointer hover:border-brand transition-colors">
                  <Upload className="w-6 h-6 text-muted" />
                  <span className="text-sm text-muted">Click to choose a spreadsheet</span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onBulkFile(f);
                    }}
                  />
                </label>
              )}

              {bulkErr && <p className="mt-4 text-sm text-red-500">{bulkErr}</p>}

              {bulkPreview && !bulkResult && (
                <div className="mt-4 rounded-lg bg-app p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-500 font-medium">{bulkPreview.valid} valid row(s)</span>
                    <span className={cn("font-medium", bulkPreview.invalid ? "text-amber-500" : "text-muted")}>
                      {bulkPreview.invalid} will be skipped
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-2">The server re-checks every row; the exact result is shown after import.</p>
                </div>
              )}

              {bulkResult && (
                <div className="mt-4 rounded-lg bg-app p-4 text-sm space-y-2">
                  <div className="font-medium text-emerald-500">
                    Imported: {bulkResult.inserted} added, {bulkResult.updated} updated
                  </div>
                  {bulkResult.skippedCount > 0 && (
                    <div>
                      <div className="text-amber-500 font-medium">{bulkResult.skippedCount} skipped:</div>
                      <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-muted list-disc pl-5">
                        {bulkResult.skipped.map((s, i) => (
                          <li key={i}>Row {s.row}{s.id ? ` (id ${s.id})` : ""}: {s.reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6" onClick={(e) => e.stopPropagation()}>
              {bulkResult ? (
                <button onClick={() => setBulkOpen(false)} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Done</button>
              ) : (
                <>
                  <button onClick={() => setBulkOpen(false)} className="rounded-lg border border-app px-4 py-2 text-sm font-medium text-muted hover:bg-app">Cancel</button>
                  <button
                    onClick={runBulk}
                    disabled={!bulkRows || bulkBusy || (bulkPreview?.valid ?? 0) === 0}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {bulkBusy ? "Importing…" : `Import ${bulkPreview?.valid ?? 0} row(s)`}
                  </button>
                </>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
