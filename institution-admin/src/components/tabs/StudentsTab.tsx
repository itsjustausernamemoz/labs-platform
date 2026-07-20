import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import { Upload, X } from 'lucide-react';
import { supabase } from '@shared/lib/apiClient';
import { useNotification } from '@shared/components/NotificationProvider';

interface StudentsTabProps {
  institutionId: string;
  onChange: () => void;
}

interface CohortSummary {
  id: string;
  name: string;
  studentCount: number;
  activeExamCount: number;
  lastActivity: string | null;
}

interface ParsedStudentRow {
  studentNumber: string;
  fullName: string;
}

interface ExistingStudentRow {
  id: string;
  student_number: string;
  institution_id: string;
}

const STUDENT_NUMBER_KEYS = ['studentnumber', 'id', 'studentid', 'regno', 'regnumber', 'registrationnumber'];
const FULL_NAME_KEYS = ['fullname', 'name', 'studentname'];
const COHORT_KEYS = ['cohort', 'class', 'group'];

function normalizeHeader(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

// Converts a raw parsed-sheet row (unknown keys/values) into a lowercased,
// whitespace-stripped lookup so we can be lenient about header naming.
function normalizeRow(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    out[normalizeHeader(key)] = String(value).trim();
  }
  return out;
}

function pickField(row: Record<string, string>, candidates: string[]): string {
  for (const candidate of candidates) {
    const value = row[candidate];
    if (value) return value;
  }
  return '';
}

export default function StudentsTab({ institutionId, onChange }: StudentsTabProps) {
  const { showToast } = useNotification();
  const [cohorts, setCohorts] = useState<CohortSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [showImport, setShowImport] = useState(false);
  const [rawRowCount, setRawRowCount] = useState(0);
  const [parsedRows, setParsedRows] = useState<ParsedStudentRow[]>([]);
  const [cohortName, setCohortName] = useState('');
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);

    const [{ data: cohortRows }, { data: studentRows }, { data: activeExamRows }] = await Promise.all([
      supabase.from('cohorts').select('id, name').eq('institution_id', institutionId).order('name'),
      supabase.from('students').select('id, cohort_id, created_at').eq('institution_id', institutionId),
      supabase.from('exams').select('id').eq('institution_id', institutionId).eq('is_active', true),
    ]);

    const students = (studentRows || []) as any[];
    const activeExamIds = new Set((activeExamRows || []).map((e: any) => e.id as string));
    const studentIds = students.map((s: any) => s.id as string);

    let enrollmentRows: { student_id: string; exam_id: string }[] = [];
    if (studentIds.length > 0) {
      const { data } = await supabase.from('enrollments').select('student_id, exam_id').in('student_id', studentIds);
      enrollmentRows = data || [];
    }

    const studentToCohort = new Map<string, string | null>(students.map((s: any) => [s.id as string, s.cohort_id as string | null]));

    // Distinct active exams per cohort, deduped with a Set.
    const examSetByCohort = new Map<string, Set<string>>();
    for (const row of enrollmentRows) {
      if (!activeExamIds.has(row.exam_id)) continue;
      const cohortId = studentToCohort.get(row.student_id);
      if (!cohortId) continue;
      if (!examSetByCohort.has(cohortId)) examSetByCohort.set(cohortId, new Set());
      examSetByCohort.get(cohortId)!.add(row.exam_id);
    }

    const countByCohort = new Map<string, number>();
    // No per-cohort "last activity" timestamp exists in the schema; the most
    // recent student.created_at within the cohort is used as a proxy.
    const lastActivityByCohort = new Map<string, string>();
    for (const s of students as any[]) {
      const cohortId = s.cohort_id as string | null;
      if (!cohortId) continue;
      countByCohort.set(cohortId, (countByCohort.get(cohortId) ?? 0) + 1);
      const createdAt = s.created_at as string;
      const existing = lastActivityByCohort.get(cohortId);
      if (!existing || createdAt > existing) lastActivityByCohort.set(cohortId, createdAt);
    }

    setCohorts(
      (cohortRows || []).map((c: any) => ({
        id: c.id as string,
        name: c.name as string,
        studentCount: countByCohort.get(c.id as string) ?? 0,
        activeExamCount: examSetByCohort.get(c.id as string)?.size ?? 0,
        lastActivity: lastActivityByCohort.get(c.id as string) ?? null,
      }))
    );
    setLoading(false);
  }, [institutionId]);

  useEffect(() => { load(); }, [load]);

  const handleFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(worksheet) as Record<string, unknown>[];

      let detectedCohort = '';
      const collected: ParsedStudentRow[] = [];
      for (const row of rows) {
        const norm = normalizeRow(row);
        const studentNumber = pickField(norm, STUDENT_NUMBER_KEYS);
        const fullName = pickField(norm, FULL_NAME_KEYS);
        if (!studentNumber || !fullName) continue;
        if (!detectedCohort) {
          const c = pickField(norm, COHORT_KEYS);
          if (c) detectedCohort = c;
        }
        collected.push({ studentNumber, fullName });
      }

      // De-dupe by student_number within the file itself (last row wins).
      const dedup = new Map<string, ParsedStudentRow>();
      for (const r of collected) dedup.set(r.studentNumber, r);
      const parsed = Array.from(dedup.values());

      if (parsed.length === 0) {
        showToast('No valid rows found — file needs a student number column and a full name column.', 'error');
        return;
      }

      setRawRowCount(rows.length);
      setParsedRows(parsed);
      setCohortName(detectedCohort);
      setShowImport(true);
    } catch (err) {
      console.error('Error parsing roster file:', err);
      showToast('Could not read that file. Make sure it is a valid .xlsx or .csv file.', 'error');
    } finally {
      event.target.value = '';
    }
  };

  const closeImport = () => {
    if (importing) return;
    setShowImport(false);
    setParsedRows([]);
    setCohortName('');
    setRawRowCount(0);
  };

  const commitImport = async () => {
    const name = cohortName.trim();
    if (!name) {
      showToast('Cohort name is required.', 'error');
      return;
    }

    setImporting(true);
    try {
      // 1. Find or create the cohort.
      let cohortId: string;
      const { data: existingCohort } = await supabase
        .from('cohorts')
        .select('id')
        .eq('institution_id', institutionId)
        .eq('name', name)
        .maybeSingle();

      if (existingCohort) {
        cohortId = existingCohort.id as string;
      } else {
        const { data: newCohort, error: cohortErr } = await supabase
          .from('cohorts')
          .insert({ institution_id: institutionId, name })
          .select('id')
          .single();
        if (cohortErr || !newCohort) throw new Error(cohortErr?.message || 'Could not create cohort.');
        cohortId = newCohort.id as string;
      }

      // 2. Look up any students that already own these student_numbers,
      // anywhere in the system (student_number is UNIQUE across ALL institutions).
      const studentNumbers = parsedRows.map(r => r.studentNumber);
      const { data: existingStudentsRaw, error: lookupErr } = await supabase
        .from('students')
        .select('id, student_number, institution_id')
        .in('student_number', studentNumbers);
      if (lookupErr) throw new Error(lookupErr.message);

      const existingStudents = (existingStudentsRaw || []) as ExistingStudentRow[];
      const existingByNumber = new Map(existingStudents.map(s => [s.student_number, s]));

      const toInsert: { student_number: string; full_name: string; institution_id: string; cohort_id: string; active: boolean }[] = [];
      const toUpdate: { id: string; full_name: string; cohort_id: string }[] = [];
      const skipped: string[] = [];

      for (const row of parsedRows) {
        const existing = existingByNumber.get(row.studentNumber);
        if (existing) {
          if (existing.institution_id !== institutionId) {
            // Belongs to a different institution — do NOT touch it. Report it back instead.
            skipped.push(row.studentNumber);
            continue;
          }
          toUpdate.push({ id: existing.id, full_name: row.fullName, cohort_id: cohortId });
        } else {
          toInsert.push({
            student_number: row.studentNumber,
            full_name: row.fullName,
            institution_id: institutionId,
            cohort_id: cohortId,
            active: true,
          });
        }
      }

      if (toInsert.length > 0) {
        const { error: insertErr } = await supabase.from('students').insert(toInsert);
        if (insertErr) throw new Error(insertErr.message);
      }

      if (toUpdate.length > 0) {
        const results = await Promise.all(
          toUpdate.map(u => supabase.from('students').update({ full_name: u.full_name, cohort_id: u.cohort_id }).eq('id', u.id))
        );
        const failed = results.find(r => r.error);
        if (failed?.error) throw new Error(failed.error.message);
      }

      const importedCount = toInsert.length + toUpdate.length;

      await supabase.rpc('log_audit_event', {
        p_action: 'Bulk-imported student roster',
        p_target: `${importedCount} students into ${name}`,
        p_institution_id: institutionId,
      });

      showToast(
        `${importedCount} student${importedCount === 1 ? '' : 's'} imported` +
          (skipped.length > 0 ? `, ${skipped.length} skipped (already registered elsewhere).` : '.'),
        'success'
      );

      closeImport();
      await load();
      onChange();
    } catch (err) {
      console.error('Error importing roster:', err);
      showToast(err instanceof Error ? err.message : 'Import failed.', 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <h3 style={{ margin: 0 }}>Students</h3>
        <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
          <Upload size={15} /> Bulk import roster
          <input type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={handleFileSelect} />
        </label>
      </div>

      {loading ? (
        <p className="text-muted">Loading cohorts…</p>
      ) : cohorts.length === 0 ? (
        <p className="text-muted">No cohorts yet — bulk import a roster to create one.</p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Cohort</th><th>Students</th><th>Active exams enrolled</th><th>Last activity</th></tr>
          </thead>
          <tbody>
            {cohorts.map(c => (
              <tr key={c.id}>
                <td style={{ fontWeight: 700 }}>{c.name}</td>
                <td>{c.studentCount}</td>
                <td>{c.activeExamCount}</td>
                <td className="text-muted">{c.lastActivity ? new Date(c.lastActivity).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showImport && (
        <div className="dialog-backdrop" onClick={closeImport}>
          <div className="dialog" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className="dialog-title">Confirm bulk import</div>
              <button className="btn btn-icon" onClick={closeImport} disabled={importing}><X size={16} /></button>
            </div>
            <p className="dialog-body">
              {rawRowCount} row{rawRowCount === 1 ? '' : 's'} found in file, {parsedRows.length} student{parsedRows.length === 1 ? '' : 's'} will
              be added to cohort "{cohortName.trim() || 'New cohort'}".
            </p>
            <div className="field">
              <label>Cohort name</label>
              <input
                className="input"
                value={cohortName}
                onChange={e => setCohortName(e.target.value)}
                placeholder="e.g. Class of 2026"
                disabled={importing}
              />
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={closeImport} disabled={importing}>Cancel</button>
              <button className="btn btn-primary" onClick={commitImport} disabled={importing || !cohortName.trim()}>
                {importing ? 'Importing…' : 'Import roster'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
