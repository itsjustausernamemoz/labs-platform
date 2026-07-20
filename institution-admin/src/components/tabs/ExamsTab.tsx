import { useEffect, useState } from 'react';
import { supabase } from '@shared/lib/apiClient';

type ExamType = 'mcq_only' | 'structured_only' | 'mixed';

interface LecturerRef {
  full_name: string | null;
}

interface ExamQueryRow {
  id: string;
  title: string;
  is_active: boolean;
  exam_type: ExamType;
  has_coding: boolean;
  lecturer_profiles: LecturerRef | LecturerRef[] | null;
}

interface ExamRow {
  id: string;
  title: string;
  lecturerName: string | null;
  isActive: boolean;
  typeLabel: string;
  submissionCount: number;
}

const EXAM_TYPE_LABEL: Record<ExamType, string> = {
  mcq_only: 'MCQ',
  structured_only: 'Structured',
  mixed: 'Mixed',
};

function resolveLecturerName(ref: ExamQueryRow['lecturer_profiles']): string | null {
  if (!ref) return null;
  const profile = Array.isArray(ref) ? ref[0] : ref;
  return profile?.full_name ?? null;
}

function resolveTypeLabel(examType: ExamType, hasCoding: boolean): string {
  const base = EXAM_TYPE_LABEL[examType] ?? examType;
  return hasCoding ? `${base}, Coding` : base;
}

export default function ExamsTab({ institutionId }: { institutionId: string }) {
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      const { data: examRows } = await supabase
        .from('exams')
        .select('id, title, is_active, exam_type, has_coding, lecturer_profiles(full_name)')
        .eq('institution_id', institutionId)
        .order('created_at', { ascending: false });

      const rows = (examRows || []) as unknown as ExamQueryRow[];
      const examIds = rows.map(r => r.id);

      let countByExamId = new Map<string, number>();
      if (examIds.length > 0) {
        const { data: submissionRows } = await supabase
          .from('submissions')
          .select('exam_id')
          .in('exam_id', examIds);

        countByExamId = (submissionRows || []).reduce((map: Map<string, number>, s: any) => {
          map.set(s.exam_id, (map.get(s.exam_id) ?? 0) + 1);
          return map;
        }, new Map<string, number>());
      }

      if (cancelled) return;

      setExams(
        rows.map(r => ({
          id: r.id,
          title: r.title,
          lecturerName: resolveLecturerName(r.lecturer_profiles),
          isActive: r.is_active,
          typeLabel: resolveTypeLabel(r.exam_type, r.has_coding),
          submissionCount: countByExamId.get(r.id) ?? 0,
        }))
      );
      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [institutionId]);

  return (
    <>
      <h3 style={{ marginTop: 0 }}>All exams</h3>
      {loading ? (
        <p className="text-muted">Loading exams…</p>
      ) : exams.length === 0 ? (
        <p className="text-muted">No exams yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Exam</th><th>Lecturer</th><th>Type</th><th>Status</th><th>Submissions</th></tr>
          </thead>
          <tbody>
            {exams.map(exam => (
              <tr key={exam.id}>
                <td style={{ fontWeight: 700 }}>{exam.title}</td>
                <td className="text-muted">{exam.lecturerName ?? '—'}</td>
                <td><span className="tag tag-outline">{exam.typeLabel}</span></td>
                <td>
                  <span className={`tag ${exam.isActive ? 'tag-accent-2' : 'tag-neutral'}`}>
                    {exam.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>{exam.submissionCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
