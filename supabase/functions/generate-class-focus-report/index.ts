import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-name',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { examId } = await req.json()
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    
    if (!geminiApiKey && !openaiApiKey) {
      throw new Error('No AI API keys configured.');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Fetch Exam Data
    const { data: exam, error: examError } = await supabase
      .from('exams')
      .select('title')
      .eq('id', examId)
      .single()

    if (examError) throw examError

    // 2. Fetch all graded submissions
    const { data: submissions, error: subError } = await supabase
      .from('submissions')
      .select('score, total_marks, marking_details, answers')
      .eq('exam_id', examId)
      .eq('graded', true)

    if (subError) throw subError
    if (!submissions || submissions.length === 0) {
      throw new Error('No graded submissions found for this exam.')
    }

    // 3. Fetch Questions
    const { data: questions, error: qError } = await supabase
      .from('questions')
      .select('*')
      .eq('exam_id', examId)

    if (qError) throw qError

    // 4. Aggregate Performance
    const totalScoreMatch = submissions.reduce((acc, s) => acc + (s.score / (s.total_marks || 1)), 0);
    const averageScore = ((totalScoreMatch / submissions.length) * 100).toFixed(1);

    // Calc Grade Distribution
    const distribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    submissions.forEach(sub => {
      const pct = (sub.score / (sub.total_marks || 1)) * 100;
      if (pct >= 80) distribution.A++;
      else if (pct >= 70) distribution.B++;
      else if (pct >= 60) distribution.C++;
      else if (pct >= 50) distribution.D++;
      else distribution.F++;
    });

    const questionAnalysis = questions.map(q => {
      let totalAwarded = 0;
      let commonFeedback = [];
      let incorrectAnswers = [];
      
      submissions.forEach(sub => {
        const detail = sub.marking_details?.[q.id];
        if (detail) {
          totalAwarded += detail.awarded_marks;
          if (detail.awarded_marks < q.marks / 2) {
            if (detail.feedback) commonFeedback.push(detail.feedback);
            if (sub.answers?.[q.id]) incorrectAnswers.push(sub.answers[q.id]);
          }
        }
      });

      const avgQScore = (totalAwarded / (submissions.length * q.marks)) * 100;
      
      return {
        question: q.question_text,
        average_score_pct: avgQScore.toFixed(1),
        common_misconceptions: commonFeedback.slice(0, 5),
        sample_incorrect_responses: incorrectAnswers.slice(0, 3)
      };
    });

    // Sort to find outliers
    const sortedQuestions = [...questionAnalysis].sort((a, b) => parseFloat(b.average_score_pct) - parseFloat(a.average_score_pct));
    const topPerformers = sortedQuestions.slice(0, 3);
    const bottomPerformers = sortedQuestions.slice(-3).reverse();

    const prompt = `
      You are an expert Educational Consultant and Pedagogical Strategist. 
      Analyze the overall performance of a class for the exam: "${exam.title}".
      Provide a "Mastery-Level Class Focus Report" to help the lecturer significantly improve student outcomes.

      OVERVIEW:
      - Total Students: ${submissions.length}
      - Class Average: ${averageScore}%
      - Grade Distribution: A:${distribution.A}, B:${distribution.B}, C:${distribution.C}, D:${distribution.D}, F:${distribution.F}

      HIGH-PERFORMING AREAS:
      ${JSON.stringify(topPerformers, null, 2)}

      AREAS OF CONCERN:
      ${JSON.stringify(bottomPerformers, null, 2)}

      TASKS:
      1. Provide a "Pedagogical SWOT Analysis":
         - STRENGTHS: What concepts have been mastered?
         - WEAKNESSES: Identify specific cognitive gaps (e.g., application vs. recall).
         - OPPORTUNITIES: Innovative teaching methods for this specific group.
         - THREATS: Long-term risks if current misconceptions persist.
      2. Identify "Common Misconceptions": Based on sample incorrect responses, what are students confusing?
      3. Provide a "4-Week Action Plan": Specific, actionable re-teaching steps.
      4. Identify "Priority Re-teaching Topics": 3-5 topics with rationale and high-impact classroom activities.
      5. BLOOM'S TAXONOMY: At what level of thinking is the class currently stalling?

      RETURN ONLY A JSON OBJECT with this structure:
      {
        "distribution_analysis": "string",
        "swot": {
          "strengths": ["string"],
          "weaknesses": ["string"],
          "opportunities": ["string"],
          "threats": ["string"]
        },
        "misconceptions": [
          { "error": "string", "correction_strategy": "string" }
        ],
        "action_plan": [
          { "week": number, "focus": "string", "activity": "string" }
        ],
        "re_teaching_topics": [
          { "topic": "string", "reason": "string", "activity_suggestion": "string" }
        ],
        "overall_summary": "string"
      }
    `;

    const callAiWithFallback = async (promptText: string) => {
      // Try Gemini first
      if (geminiApiKey) {
        try {
          const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptText }] }],
              generationConfig: { temperature: 0.2 }
            })
          });

          if (geminiRes.ok) {
            const data = await geminiRes.json();
            return data.candidates[0].content.parts[0].text;
          }
        } catch (e) {
          console.error('Gemini failed, trying OpenAI:', e);
        }
      }

      // Fallback to OpenAI
      if (openaiApiKey) {
        const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.2
          })
        });

        if (openaiRes.ok) {
          const data = await openaiRes.json();
          return data.choices[0].message.content;
        }
      }

      throw new Error('AI analysis failed.');
    };

    const aiResponse = await callAiWithFallback(prompt);
    
    // Clean JSON if needed
    const jsonMatch = aiResponse.match(/\{.*\}/s);
    const reportData = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(aiResponse);

    return new Response(JSON.stringify(reportData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
